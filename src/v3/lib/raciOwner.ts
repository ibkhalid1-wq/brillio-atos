/**
 * Derive a primary owner for a piece of work (a RAID entry or decision) from the
 * RACI matrix and the core-team roster. The RACI names the role accountable for an
 * activity; the roster names the person filling that role. Bridging them gives a
 * human owner without the user re-typing one — a display-only suggestion, never
 * written back, so it stays correct as the roster and RACI evolve.
 */

import { canonicalRole, resolveRosterField, ROSTER_PHASE_ID } from "@/v3/lib/phaseInputSchema";
import type { DynamicSchemaStore } from "@/v3/lib/dynamicSchema";
import { parseRows } from "@/v3/components/StructuredGrid";
import {
  readRaciMatrix,
  rosterColumnKeys,
  rosterRoleToNameMap,
  type RaciActivity,
  type RaciMatrix,
} from "@/v3/lib/rosterRaci";

const STOPWORDS = new Set([
  "the", "a", "an", "and", "or", "of", "to", "for", "in", "on", "with", "by",
  "is", "are", "be", "at", "as", "from", "into", "via", "per", "this", "that",
]);

/** Significant lowercase word tokens of a title/activity, stopwords dropped. */
function titleTokens(text: string | null | undefined): Set<string> {
  return new Set(
    String(text ?? "")
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, " ")
      .split(/\s+/)
      .filter((t) => t.length > 2 && !STOPWORDS.has(t)),
  );
}

/** Share of the smaller token set the two titles have in common (0..1). */
function overlapScore(a: Set<string>, b: Set<string>): number {
  if (a.size === 0 || b.size === 0) return 0;
  let shared = 0;
  for (const token of a) if (b.has(token)) shared += 1;
  return shared / Math.min(a.size, b.size);
}

/** Min token overlap for a RACI activity to be considered this item's match. */
const MATCH_THRESHOLD = 0.34;

/**
 * The RACI activity whose wording best matches the item title, or null when none
 * clears the overlap bar (so an unrelated item never borrows a random owner).
 */
export function bestRaciActivityForTitle(title: string, activities: RaciActivity[]): RaciActivity | null {
  const wanted = titleTokens(title);
  if (wanted.size === 0) return null;
  let best: RaciActivity | null = null;
  let bestScore = 0;
  for (const activity of activities) {
    if (!activity.activity) continue;
    const score = overlapScore(wanted, titleTokens(activity.activity));
    if (score > bestScore) {
      bestScore = score;
      best = activity;
    }
  }
  return bestScore >= MATCH_THRESHOLD ? best : null;
}

/**
 * The role held accountable across the most activities — the programme's default
 * owner when an item maps to no specific activity. De-duplicated by role family.
 */
export function mostFrequentAccountableRole(raci: RaciMatrix): string | undefined {
  const counts = new Map<string, { role: string; n: number }>();
  for (const activity of raci.activities) {
    const role = activity.accountable?.trim();
    if (!role) continue;
    const key = canonicalRole(role) || role.toLowerCase();
    const existing = counts.get(key);
    if (existing) existing.n += 1;
    else counts.set(key, { role, n: 1 });
  }
  let best: string | undefined;
  let bestN = 0;
  for (const { role, n } of counts.values()) {
    if (n > bestN) {
      bestN = n;
      best = role;
    }
  }
  return best;
}

/**
 * Resolve a person to own an item: the accountable role of the best-matching RACI
 * activity (or the programme's most-frequent accountable role as a fallback),
 * mapped to a name via the roster. Null when nothing resolves.
 */
export function resolveOwnerName(
  title: string,
  raci: RaciMatrix | null,
  roleToName: Map<string, string>,
): string | null {
  if (!raci || raci.activities.length === 0 || roleToName.size === 0) return null;
  const matched = bestRaciActivityForTitle(title, raci.activities);
  const role = matched?.accountable?.trim() || mostFrequentAccountableRole(raci);
  if (!role) return null;
  return roleToName.get(canonicalRole(role) || role.toLowerCase()) ?? null;
}

/**
 * Build a `(title) => ownerName | null` resolver from a program data root, or null
 * when the RACI/roster aren't both populated. The caller decides *when* to apply
 * it (e.g. only once the Mobilise gate is approved) — this stays gate-agnostic.
 */
export function buildRaciOwnerResolver(
  source: Record<string, unknown> | null | undefined,
  dynamicStore?: DynamicSchemaStore,
): ((title: string) => string | null) | null {
  const raci = readRaciMatrix(source);
  if (!raci || raci.activities.length === 0) return null;

  const rosterField = resolveRosterField(dynamicStore);
  const columns = rosterField?.columns ?? [];
  if (!rosterField || !columns.length) return null;
  const { roleKey, nameKey } = rosterColumnKeys(columns);
  if (!roleKey || !nameKey) return null;

  const phaseInputs = source?.phaseInputs && typeof source.phaseInputs === "object" && !Array.isArray(source.phaseInputs)
    ? (source.phaseInputs as Record<string, unknown>)[ROSTER_PHASE_ID]
    : null;
  const rosterValue = phaseInputs && typeof phaseInputs === "object" && !Array.isArray(phaseInputs)
    ? (phaseInputs as Record<string, unknown>)[rosterField.id]
    : null;
  const rows = parseRows(rosterValue, columns);
  const roleToName = rosterRoleToNameMap(rows, roleKey, nameKey);
  if (roleToName.size === 0) return null;

  return (title: string) => resolveOwnerName(title, raci, roleToName);
}
