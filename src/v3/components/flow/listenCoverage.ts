/**
 * listenCoverage — the ONE source of the people×areas coverage model and its
 * edits, consumed by the Discovery Kit matrix (DiscoveryKitAlign — the sole
 * coverage editor since the reimagined-chrome merge retired FrameCoveragePlan).
 * A coverage-rule change lands in one place.
 *
 * A leaf module: it depends on flowAreas + flowStakeholders, neither depends on
 * it, so there is no import cycle.
 */
import type { ProgramSummary } from "@/new/types";
import { programAreas, GENERAL_AREA, stakeholderPrimaryArea } from "@/v3/components/flow/flowAreas";
import { resolveMovementStakeholders, readDirectoryPeople, dismissedListenRoles, validateProgramRole, readListenPlan, listenPlanWrite, readListenPlanOrder, type ListenPlanOverlay, type ListenPlanOrder } from "@/v3/components/flow/flowStakeholders";

export interface CoverageRole { label: string; name?: string; added: boolean }
export interface CoverageArea { label: string; added: boolean }

const AREA_STOP = ["and", "the", "of", "amp"];
const covTokens = (a: string): Set<string> =>
  new Set(a.toLowerCase().split(/[^a-z0-9]+/).filter((t) => t && !AREA_STOP.includes(t)));
const areaNorm = (a: string) => a.trim().toLowerCase();

/** Sort by the operator's saved order; items it doesn't know keep their
 * derived position after the ordered ones (stable sort, equal keys). */
const applyOrder = <T,>(items: T[], labelOf: (item: T) => string, order: string[]): T[] => {
  if (!order.length) return items;
  const idx = new Map(order.map((label, i) => [label.toLowerCase(), i]));
  return [...items].sort((a, b) =>
    (idx.get(labelOf(a).toLowerCase()) ?? Number.MAX_SAFE_INTEGER)
    - (idx.get(labelOf(b).toLowerCase()) ?? Number.MAX_SAFE_INTEGER));
};

/** The deduped roster (roles/people) for Listen, tagged whether operator-added. */
export function listenCoverageRoles(program: ProgramSummary): CoverageRole[] {
  const directoryNames = new Set(readDirectoryPeople(program).filter((p) => p.movementId === "listen").map((p) => p.name.trim().toLowerCase()));
  const seen = new Map<string, CoverageRole>();
  for (const person of resolveMovementStakeholders(program, "listen")) {
    const key = (person.role || person.name).trim().toLowerCase();
    if (!key || seen.has(key)) continue;
    seen.set(key, { label: person.role || person.name, name: person.isRole ? undefined : person.name, added: directoryNames.has(person.name.trim().toLowerCase()) });
  }
  return applyOrder([...seen.values()], (r) => r.label, readListenPlanOrder(program).roles);
}

/** Derived areas (from the ontology) + operator-added, minus dismissed. */
export function listenCoverageAreas(program: ProgramSummary, plan: ListenPlanOverlay = readListenPlan(program)): CoverageArea[] {
  const dismissed = new Set(plan.dismissedAreas.map(areaNorm));
  const derived = programAreas(program).filter((a) => a && a !== GENERAL_AREA);
  const seen = new Set(derived.map((a) => a.toLowerCase()));
  const extra = plan.areas.filter((a) => !seen.has(a.toLowerCase()));
  const areas = [...derived.map((a) => ({ label: a, added: false })), ...extra.map((a) => ({ label: a, added: true }))]
    .filter((a) => !dismissed.has(areaNorm(a.label)));
  return applyOrder(areas, (a) => a.label, readListenPlanOrder(program).areas);
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

/**
 * Canonicalise a free-form area label onto the FRAME's area list (the same
 * list the Discovery Kit covers): exact label first, else the frame area
 * sharing the most words ("Sales & Delivery" → Delivery), else General.
 * Shared by the Atlas's workflow grouping and the collect boards so every
 * surface speaks the kit's own vocabulary.
 */
export function canonicalFrameArea(frameAreas: string[], raw: string): string {
  const label = raw.trim();
  if (!frameAreas.length) return label || GENERAL_AREA;
  const exact = frameAreas.find((area) => area.toLowerCase() === label.toLowerCase());
  if (exact) return exact;
  const words = new Set(label.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3));
  let best: { area: string; score: number } | null = null;
  for (const area of frameAreas) {
    const areaWords = area.toLowerCase().split(/[^a-z0-9]+/).filter((word) => word.length >= 3);
    if (!areaWords.length) continue;
    const hits = areaWords.filter((word) => words.has(word)).length;
    const score = hits / areaWords.length;
    if (hits && (!best || score > best.score)) best = { area, score };
  }
  return best?.area ?? GENERAL_AREA;
}

/**
 * The operator's CURRENT roster and area labels as prompt guidance for the
 * Discovery-Kit regenerator. Without this, the agent re-derives interviews
 * from evidence and resurrects labels the operator renamed or removed —
 * their curation must outrank the transcripts it was applied to.
 */
export function listenCanonicalCastGuidance(program: ProgramSummary): string | null {
  const roles = listenCoverageRoles(program);
  const areas = listenCoverageAreas(program);
  if (!roles.length && !areas.length) return null;
  const dismissedRoles = [...dismissedListenRoles(program)];
  const dismissedAreas = readListenPlan(program).dismissedAreas;
  const lines = ["## Canonical cast and area names (operator-curated — use these labels VERBATIM)"];
  if (roles.length) {
    lines.push(`Interview roles/stakeholders — every interview must use exactly one of these labels (no variants, no replaced or invented names): ${roles.map((r) => (r.name && r.name !== r.label ? `${r.label} (person: ${r.name})` : r.label)).join("; ")}.`);
  }
  if (areas.length) lines.push(`Coverage domains — use exactly these area names: ${areas.map((a) => a.label).join("; ")}.`);
  if (dismissedRoles.length) lines.push(`Labels the operator REMOVED or RENAMED AWAY — never reintroduce them under any spelling or casing: ${dismissedRoles.join("; ")}.`);
  if (dismissedAreas.length) lines.push(`Areas the operator REMOVED or RENAMED AWAY — never reintroduce: ${dismissedAreas.join("; ")}.`);
  return lines.join("\n");
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
  // frameExtra rides along for frame-bucket side fields (e.g. the order overlay
  // when a rename must keep the renamed column/row in its slot).
  const writePlan = async (next: Partial<ListenPlanOverlay>, listenExtra?: Record<string, string>, frameExtra?: Record<string, string>) => {
    if (!onSaveInputs) return;
    const plan = readListenPlan(program);
    const merged: ListenPlanOverlay = { roles: plan.roles, areas: plan.areas, coverage: plan.coverage, dismissedAreas: plan.dismissedAreas, ...next };
    const { frame, planRev } = listenPlanWrite(merged);
    await onSaveInputs("frame", { ...frame, ...(frameExtra ?? {}) }, { silent: true, extraInputs: { listen: { planRev, ...(listenExtra ?? {}) }, envision: { planRev }, show: { planRev } } });
  };
  // Order is presentational: an underscore field, ONE silent write, no
  // planRev stamps — reordering must not stale artifacts or re-open gates.
  const writeOrder = async (next: Partial<ListenPlanOrder>) => {
    if (!onSaveInputs) return;
    const order: ListenPlanOrder = { ...readListenPlanOrder(program), ...next };
    await onSaveInputs("frame", { _listenPlanOrder: JSON.stringify(order) }, { silent: true });
  };
  const shifted = (labels: string[], label: string, delta: number): string[] | null => {
    const from = labels.indexOf(label);
    const to = from + delta;
    if (from < 0 || to < 0 || to >= labels.length) return null;
    const next = [...labels];
    [next[from], next[to]] = [next[to], next[from]];
    return next;
  };
  return {
    dirEntry,
    writePlan,
    /** Pin an explicit column/row order — the drag-drop path. */
    setAreaOrder: (labels: string[]) => writeOrder({ areas: labels }),
    setRoleOrder: (labels: string[]) => writeOrder({ roles: labels }),
    moveArea: (area: string, delta: number) => {
      const next = shifted(listenCoverageAreas(program).map((a) => a.label), area, delta);
      return next ? writeOrder({ areas: next }) : Promise.resolve();
    },
    moveRole: (label: string, delta: number) => {
      const next = shifted(listenCoverageRoles(program).map((r) => r.label), label, delta);
      return next ? writeOrder({ roles: next }) : Promise.resolve();
    },
    /** Rename an area IN PLACE: coverage follows, the column keeps its slot.
     * A derived label can't change at its source, so old is dismissed and the
     * new name added as an operator area — substantive, so it stales the kit. */
    renameArea: (area: string, nextName: string) => {
      const to = nextName.trim();
      if (!to || areaNorm(to) === areaNorm(area)) return Promise.resolve();
      const plan = readListenPlan(program);
      const shownNow = listenCoverageAreas(program, plan);
      if (shownNow.some((a) => areaNorm(a.label) === areaNorm(to))) return Promise.resolve();
      const roles = listenAreaCoverage(program, plan, undefined, shownNow).find((c) => c.area === area)?.roles ?? [];
      const cov = { ...plan.coverage }; delete cov[area]; cov[to] = roles;
      const order = readListenPlanOrder(program);
      return writePlan({
        areas: [...plan.areas.filter((a) => areaNorm(a) !== areaNorm(area)), to],
        dismissedAreas: [...new Set([...plan.dismissedAreas, area.trim()])].filter((d) => areaNorm(d) !== areaNorm(to)),
        coverage: cov,
      }, undefined, { _listenPlanOrder: JSON.stringify({ ...order, areas: shownNow.map((a) => (a.label === area ? to : a.label)) }) });
    },
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
