/**
 * WHICH LEDGER LABELS A PERSON OWNS.
 *
 * The ledger owns each locus by ONE function label. This module is the single
 * definition of how a person on the roster binds to those labels — extracted
 * from an inline `useMemo` in TheLine so the rule can be asserted directly
 * instead of through a rendered card.
 *
 * THE DEFECT THIS EXISTS TO PREVENT (found 2026-08-11 on live Laila, via a
 * Talent Acquisition card claiming 74 owned questions):
 *
 *   const primary = fn(row.role) ?? fn(row.label) ?? fn(row.area);
 *
 * `functionOf` is a CRM function table. It has no entry for "Talent
 * Acquisition", so a real, stated role returned null and fell through to the
 * person's AREA — and nearly everyone's area is Sales. A recruiter was handed
 * all 64 Sales Leaders questions: opportunity stages, deal reviews, buying
 * committees. Their own eight staffing questions were buried in someone else's
 * work. The code comment directly above that line warned about "area-inherited
 * bleed"; the UNION had been removed and the FALLBACK had not.
 *
 * THE RULE: the area is a fallback for people who state NO role, not a
 * substitute for a role we failed to resolve. An unresolved role is a MISS, and
 * a miss stays visible — someone whose role the table cannot map owns only what
 * matches them exactly, and surfaces as unbound rather than as a full card of
 * another function's work. A card that looks populated is worth nothing if the
 * questions on it belong to somebody else.
 */
import { ownerRoleLabelForArea } from "./migrate";

export interface CastRow {
  /** Display name — what the roster shows. */
  label: string;
  /** Stated role/title, if the person gave one. */
  role?: string;
  /** Primary coverage area. */
  area?: string;
}

const norm = (s: string) => s.trim().toLowerCase().replace(/\s+/g, " ");

/**
 * The labels one person owns. `ledgerLabels` are the ledger's own owner labels
 * (`store.soloByOwner.keys()`), which on non-CRM programmes are atlas-stated
 * strings the CRM table knows nothing about.
 */
export function ownerLabelsForRow(row: CastRow, ledgerLabels: readonly string[]): Set<string> {
  const labels = new Set<string>();

  // A person owns their PRIMARY function — from their ROLE/title, else, only if
  // they stated no role at all, their primary area. NOT the union of every
  // coverage area they're tagged with: nearly everyone "covers" Sales, so
  // unioning coverage reproduces the same bleed from the other direction
  // (Alliances inheriting Sales-handoff questions).
  const stated = (row.role ?? "").trim() || row.label.trim();
  const primary =
    ownerRoleLabelForArea(row.role ?? "") ??
    ownerRoleLabelForArea(row.label) ??
    (stated ? null : ownerRoleLabelForArea(row.area ?? ""));
  if (primary) labels.add(primary);

  // ATLAS-STATED owners (non-CRM domains): the ledger can own a locus by the
  // atlas's own workflow.owner / step.actor string. Bind by EXACT normalized
  // match on role or name only — never fuzzy (the "Surgical Operations" →
  // Sales Ops false-match lesson). This is how the recruiter above still gets
  // their eight real questions: "Talent Acquisition" IS a ledger label, it just
  // isn't a CRM function. A label nobody matches stays visible in the
  // unbound-owners strip, never silently unclaimed.
  for (const L of ledgerLabels) {
    const n = norm(L);
    if (n === norm(row.role ?? "") || n === norm(row.label)) labels.add(L);
  }

  return labels;
}

/** The whole roster, keyed by display label. */
export function ownerLabelsForCast(
  cast: readonly CastRow[],
  ledgerLabels: readonly string[],
): Map<string, Set<string>> {
  const m = new Map<string, Set<string>>();
  for (const row of cast) m.set(row.label, ownerLabelsForRow(row, ledgerLabels));
  return m;
}
