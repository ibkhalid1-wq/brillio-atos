/**
 * Shared helpers that bridge the Mobilise core-team roster and the RACI matrix.
 * Both artifacts describe the same set of programme roles from two angles — the
 * roster names a person per role, the RACI assigns accountability per activity —
 * so reconciling them (placeholder rows for unstaffed roles, resolving an owner
 * for a piece of work) lives here, beside the roster's canonical address.
 */

import type { GridColumn } from "@/v3/lib/phaseInputSchema";
import { canonicalRole, matchColumnKey, rolesMatch } from "@/v3/lib/phaseInputSchema";
import type { GridRow } from "@/v3/components/StructuredGrid";

export interface RaciActivity {
  activity?: string;
  responsible?: string[];
  accountable?: string;
  consulted?: string[];
  informed?: string[];
}

export interface RaciMatrix {
  activities: RaciActivity[];
  gaps: string[];
}

function asStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((v): v is string => typeof v === "string" && v.trim().length > 0).map((v) => v.trim());
}

/** Read the structured RACI matrix from a program data root, or null when absent. */
export function readRaciMatrix(source: Record<string, unknown> | null | undefined): RaciMatrix | null {
  const raw = source?.raciMatrix;
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const obj = raw as Record<string, unknown>;
  const activitiesRaw = Array.isArray(obj.activities) ? obj.activities : [];
  const activities: RaciActivity[] = activitiesRaw
    .filter((a): a is Record<string, unknown> => !!a && typeof a === "object" && !Array.isArray(a))
    .map((a) => ({
      activity: typeof a.activity === "string" ? a.activity : undefined,
      responsible: asStringArray(a.responsible),
      accountable: typeof a.accountable === "string" ? a.accountable.trim() : undefined,
      consulted: asStringArray(a.consulted),
      informed: asStringArray(a.informed),
    }));
  return { activities, gaps: asStringArray(obj.gaps) };
}

/**
 * The distinct delivery roles a RACI matrix names. Accountable and responsible
 * roles are the people who own and do the work — the core team the roster must
 * carry — so they seed the roster; consulted/informed are advisory and excluded.
 * Returns roles in first-seen order, de-duplicated by canonical family.
 */
export function raciDeliveryRoles(raci: RaciMatrix | null): string[] {
  if (!raci) return [];
  const seen = new Set<string>();
  const roles: string[] = [];
  for (const activity of raci.activities) {
    const candidates = [activity.accountable, ...(activity.responsible ?? [])];
    for (const role of candidates) {
      if (!role || !role.trim()) continue;
      const key = canonicalRole(role) || role.trim().toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      roles.push(role.trim());
    }
  }
  return roles;
}

/** Resolve the roster grid's role and name column keys from its columns. */
export function rosterColumnKeys(columns: GridColumn[]): { roleKey: string | undefined; nameKey: string | undefined } {
  return {
    roleKey: matchColumnKey(columns, /role|title|position/i),
    nameKey: matchColumnKey(columns, /name/i),
  };
}

/** RACI roles that have no matching row in the roster (by role-family match). */
export function missingRosterRoles(rows: GridRow[], roleKey: string | undefined, roles: string[]): string[] {
  if (!roleKey) return [];
  const present = rows.map((row) => (row[roleKey] ?? "").trim()).filter(Boolean);
  return roles.filter((role) => !present.some((existing) => rolesMatch(existing, role)));
}

/**
 * Map of canonical role family → named person, built from roster rows that carry
 * a non-empty name. Used to resolve a primary owner for a piece of work from the
 * role the RACI holds accountable.
 */
export function rosterRoleToNameMap(rows: GridRow[], roleKey: string | undefined, nameKey: string | undefined): Map<string, string> {
  const map = new Map<string, string>();
  if (!roleKey || !nameKey) return map;
  for (const row of rows) {
    const role = (row[roleKey] ?? "").trim();
    const name = (row[nameKey] ?? "").trim();
    if (!role || !name) continue;
    const key = canonicalRole(role) || role.toLowerCase();
    if (!map.has(key)) map.set(key, name);
  }
  return map;
}
