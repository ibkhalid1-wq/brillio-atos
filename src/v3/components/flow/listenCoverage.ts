/**
 * listenCoverage — the ONE source of the people×areas coverage model and its
 * edits, shared by the classic Listen coverage plan (FrameCoveragePlan) and the
 * reimagined Discovery Kit matrix (DiscoveryKitAlign). Both used to derive roles,
 * areas and coverage — and write the `listenPlan` overlay — with byte-identical
 * logic in two files; a coverage-rule change now lands in one place.
 *
 * A leaf module: it depends on flowAreas + flowStakeholders, neither depends on
 * it, so there is no import cycle.
 */
import type { ProgramSummary } from "@/new/types";
import { programAreas, GENERAL_AREA, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { resolveMovementStakeholders, readDirectoryPeople, dismissedListenRoles, validateProgramRole, readListenPlan, listenPlanWrite, type ListenPlanOverlay } from "@/v3/components/flow/flowStakeholders";

export interface CoverageRole { label: string; name?: string; added: boolean }
export interface CoverageArea { label: string; added: boolean }

const AREA_STOP = ["and", "the", "of", "amp"];
const covTokens = (a: string): Set<string> =>
  new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !AREA_STOP.includes(t)));
const areaNorm = (a: string) => a.trim().toLowerCase();

/** The deduped roster (roles/people) for Listen, tagged whether operator-added. */
export function listenCoverageRoles(program: ProgramSummary): CoverageRole[] {
  const directoryNames = new Set(readDirectoryPeople(program).filter((p) => p.movementId === "listen").map((p) => p.name.trim().toLowerCase()));
  const seen = new Map<string, CoverageRole>();
  for (const person of resolveMovementStakeholders(program, "listen")) {
    const key = (person.role || person.name).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, { label: person.role || person.name, name: person.isRole ? undefined : person.name, added: directoryNames.has(person.name.trim().toLowerCase()) });
  }
  return [...seen.values()];
}

/** Derived areas (from the ontology) + operator-added, minus dismissed. */
export function listenCoverageAreas(program: ProgramSummary, plan: ListenPlanOverlay = readListenPlan(program)): CoverageArea[] {
  const dismissed = new Set(plan.dismissedAreas.map(areaNorm));
  const derived = programAreas(program).filter((a) => a && a !== GENERAL_AREA);
  const seen = new Set(derived.map((a) => a.toLowerCase()));
  const extra = plan.areas.filter((a) => !seen.has(a.toLowerCase()));
  return [...derived.map((a) => ({ label: a, added: false })), ...extra.map((a) => ({ label: a, added: true }))]
    .filter((a) => !dismissed.has(areaNorm(a.label)));
}

/** Who covers each area — the EXPLICIT hand-curated list wins (even empty), else
 * the title-inferred match. This is the coverage RULE, now in one place. */
export function listenAreaCoverage(
  program: ProgramSummary,
  plan: ListenPlanOverlay = readListenPlan(program),
  roles: CoverageRole[] = listenCoverageRoles(program),
  areas: CoverageArea[] = listenCoverageAreas(program, plan),
): Array<{ area: string; roles: string[]; explicit: boolean; added: boolean }> {
  const rolePrimary = roles.map((r) => ({ label: r.label, area: stakeholderPrimaryArea(program, r.name || r.label, r.label) }));
  return areas.map((a) => {
    const explicit = plan.coverage[a.label];
    if (explicit) return { area: a.label, roles: explicit, explicit: true, added: a.added };
    const at = covTokens(a.label);
    const covering = rolePrimary.filter((rp) => [...covTokens(rp.area)].some((t) => at.has(t))).map((rp) => rp.label);
    return { area: a.label, roles: [...new Set(covering)], explicit: false, added: a.added };
  });
}

type SaveInputs = (phaseId: string, inputs: Record<string, string>, opts?: { silent?: boolean; extraInputs?: Record<string, Record<string, string>> }) => Promise<void> | void;

/** The plan-overlay write actions, shared by both editors. Each caller supplies
 * its own onSaveInputs and busy handling; the store semantics live here. */
export function makeListenPlanWriter(program: ProgramSummary, onSaveInputs: SaveInputs | undefined) {
  const dirEntry = (role: string) => ({
    id: `dp-${Date.now().toString(36)}-${role.toLowerCase().replace(/[^a-z0-9]+/g, "").slice(0, 8)}`,
    name: role, role, email: undefined, movementId: "listen", roleResolved: validateProgramRole(program, role).known,
  });
  // Persist a PARTIAL overlay merged onto the current plan; stamp planRev into
  // Listen/Envision/Show so their artifacts stale for regeneration. ONE write.
  const writePlan = async (next: Partial<ListenPlanOverlay>, listenExtra?: Record<string, string>) => {
    if (!onSaveInputs) return;
    const plan = readListenPlan(program);
    const merged: ListenPlanOverlay = { roles: plan.roles, areas: plan.areas, coverage: plan.coverage, dismissedAreas: plan.dismissedAreas, ...next };
    const { frame, planRev } = listenPlanWrite(merged);
    await onSaveInputs("frame", frame, { silent: true, extraInputs: { listen: { planRev, ...(listenExtra ?? {}) }, envision: { planRev }, show: { planRev } } });
  };
  return {
    dirEntry,
    writePlan,
    setAreaRoles: (area: string, nextRoles: string[]) =>
      writePlan({ coverage: { ...readListenPlan(program).coverage, [area]: [...new Set(nextRoles)] } }),
    addArea: (area: string) => {
      const plan = readListenPlan(program);
      return writePlan({ areas: [...plan.areas, area], dismissedAreas: plan.dismissedAreas.filter((d) => areaNorm(d) !== areaNorm(area)) });
    },
    removeArea: (area: string) => {
      const plan = readListenPlan(program);
      const cov = { ...plan.coverage }; delete cov[area];
      return writePlan({ dismissedAreas: [...new Set([...plan.dismissedAreas, area.trim()])], areas: plan.areas.filter((x) => x.toLowerCase() !== area.toLowerCase()), coverage: cov });
    },
    addRole: (role: string) => {
      const plan = readListenPlan(program);
      return writePlan({ roles: [...plan.roles, role] }, { _directoryPeople: JSON.stringify([...readDirectoryPeople(program), dirEntry(role)]) });
    },
    removeRole: (role: { label: string; name?: string }) => {
      const plan = readListenPlan(program);
      const key = role.label.trim().toLowerCase();
      const dropName = (role.name || role.label).trim().toLowerCase();
      const dir = readDirectoryPeople(program).filter((p) => p.name.trim().toLowerCase() !== dropName);
      const dm = new Set(dismissedListenRoles(program)); dm.add(key); if (role.name) dm.add(dropName);
      const cov = Object.fromEntries(Object.entries(plan.coverage).map(([area, list]) => [area, (list as string[]).filter((x) => x !== role.label)]));
      return writePlan({ roles: plan.roles.filter((x) => x.toLowerCase() !== key), coverage: cov }, { _directoryPeople: JSON.stringify(dir), _dismissedListenRoles: JSON.stringify([...dm]) });
    },
  };
}
