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
import { programAreas, canonicalFrameArea, GENERAL_AREA, kitCoverageDomains, kitCoverageRows, stakeholderPrimaryArea, workflowArea } from "@/v3/components/flow/flowAreas";

// Re-exported: it lives in flowAreas now because programAreas needs it, and
// flowAreas cannot import from here without a cycle.
export { canonicalFrameArea };
import { resolveMovementStakeholders, readDirectoryPeople, dismissedListenRoles, validateProgramRole, readListenPlan, listenPlanWrite, readListenPlanOrder, type ListenPlanOverlay, type ListenPlanOrder } from "@/v3/components/flow/flowStakeholders";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";

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
  // The Discovery Kit is where coverage is actually DECLARED — an operator sets
  // "Vimal Pandey covers Finance" in the kit's matrix. Listen used to ignore it
  // and re-derive the answer from stakeholderPrimaryArea, which scores people
  // against ATLAS workflows; anyone the Atlas has not placed scores nothing and
  // the area reads as uncovered. That is how Finance showed "no one covers this
  // area" while the kit plainly assigned it. The kit's own statement now ranks
  // above the inference and below only the operator's explicit override.
  const kitByRole = new Map<string, Set<string>>();
  for (const row of kitCoverageRows(program)) {
    const domToks = covTokens(row.domain);
    if (!domToks.size) continue;
    for (const person of row.coveredBy) {
      const key = person.toLowerCase();
      const match = roles.find((r) => (r.name || "").toLowerCase() === key || r.label.toLowerCase() === key);
      if (!match) continue;
      const set = kitByRole.get(match.label) ?? new Set<string>();
      for (const t of domToks) set.add(t);
      kitByRole.set(match.label, set);
    }
  }
  return areas.map((a) => {
    const explicit = plan.coverage[a.label];
    if (explicit) return { area: a.label, roles: explicit, explicit: true, added: a.added };
    const at = covTokens(a.label);
    const fromKit = [...kitByRole].filter(([, toks]) => [...toks].some((t) => at.has(t))).map(([label]) => label);
    if (fromKit.length) return { area: a.label, roles: [...new Set(fromKit)], explicit: false, added: a.added };
    const covering = rolePrimary.filter((rp) => [...covTokens(rp.area)].some((t) => at.has(t))).map((rp) => rp.label);
    return { area: a.label, roles: [...new Set(covering)], explicit: false, added: a.added };
  });
}


/**
 * The Discovery Kit's domains, shipped to the generators as the AREA VOCABULARY.
 *
 * Neither the ontology nor the atlas prompt has ever been told what the areas
 * are. Each declares "area" only inside a JSON field description, and each
 * describes it with hardcoded generic examples ("e.g. Sales, Marketing,
 * Finance") - on a hospital programme those are actively misleading, and they
 * are the only concrete vocabulary either agent sees. Worse, the ontology is
 * told to reuse the atlas's labels, so the ontology anchors to the atlas and
 * the atlas anchors to nothing: the chain ends in a guess, and neither end is
 * tied to the kit, where the operator actually agreed the areas.
 *
 * That is why Discovery, the ontology and the atlas each named areas the kit
 * had never heard of. Canonicalising in programAreas fixes what is DISPLAYED;
 * this fixes what is WRITTEN, so a regeneration stops re-inventing labels. Same
 * treatment the ontology's standards packs already get: supply the vocabulary
 * as facts rather than hoping the model guesses the house style.
 */
export function areaVocabularyGuidance(program: ProgramSummary): string | null {
  // Compound labels are spanning tags on a person, never areas to file under.
  const domains = kitCoverageDomains(program)
    .map((d) => d.trim())
    .filter((d) => d && !d.includes("/"));
  if (domains.length < 2) return null;
  return [
    "## AREA VOCABULARY \u2014 use these labels, verbatim",
    `This programme's business areas were agreed in the Discovery Kit: ${domains.join(", ")}.`,
    'Every "area" field you emit MUST be one of those labels, copied exactly \u2014 same words, same casing, same punctuation. Do not translate, abbreviate, pluralise, or coin a near-synonym: writing "Pre-Operative Care" when the kit says "Pre-Op Nursing" creates two areas for one thing, and every downstream surface then disagrees about which exists.',
    "Ignore any generic examples in the field descriptions \u2014 they are placeholders, and this list supersedes them.",
    'If something genuinely belongs to no listed area, use "General" rather than coining a label. Adding an area is an operator decision, not a generation-time one.',
  ].join("\n");
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

const isRec = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const recArr = (value: unknown): Record<string, unknown>[] => (Array.isArray(value) ? value.filter(isRec) : []);
const txt = (value: unknown): string => String(value ?? "").trim();

/**
 * The Listen triangle, reconciled PER AREA: does the kit cover it, does the
 * ontology model it, does the atlas map it, and do the kit's questions for
 * its people actually name its entities? One row per Frame area — the
 * glanceable answer to "Talent Acquisition has ontology but no workflows
 * and the questions aren't aligned".
 */
export interface AreaCoherenceRow {
  area: string;
  /** The kit matrix assigns at least one person to it. */
  covered: boolean;
  /** Ontology entities filed under it (canonicalised). */
  entities: number;
  /** Atlas workflows filed under it (canonicalised). */
  workflows: number;
  /** ≥1 kit question for its people names one of its entities. */
  questionsAligned: boolean;
}
export function areaCoherence(
  program: ProgramSummary,
  liveWorkflows?: Record<string, unknown>[],
): AreaCoherenceRow[] {
  const areas = listenCoverageAreas(program).map((area) => area.label);
  if (!areas.length) return [];
  const coverage = listenAreaCoverage(program);
  const entities = recArr(readArtifactDoc(program, "domainOntology")?.entities);
  const workflows = liveWorkflows ?? recArr(readArtifactDoc(program, "currentStateAtlas")?.workflows);
  const interviews = recArr(readArtifactDoc(program, "discoveryKit")?.interviews);
  const questionsOf = (interview: Record<string, unknown>): string[] => [
    ...recArr(interview.agenda).flatMap((block) => (Array.isArray(block.questions) ? block.questions.map(txt) : [])),
    ...(Array.isArray(interview.questions) ? interview.questions.map(txt) : []),
  ];
  return areas.map((area) => {
    const roles = new Set((coverage.find((row) => row.area === area)?.roles ?? []).map((role) => role.toLowerCase()));
    const areaEntities = entities.filter((entity) => txt(entity.area) && canonicalFrameArea(areas, txt(entity.area)) === area);
    const areaWorkflows = workflows.filter((workflow) => canonicalFrameArea(areas, workflowArea(workflow)) === area);
    const questionText = interviews
      .filter((interview) => roles.has(txt(interview.role).toLowerCase()) || roles.has(txt(interview.stakeholder).toLowerCase()))
      .flatMap(questionsOf).join(" ").toLowerCase();
    const questionsAligned = areaEntities.some((entity) => {
      const name = txt(entity.name).toLowerCase();
      return name.length >= 3 && questionText.includes(name);
    });
    return { area, covered: roles.size > 0, entities: areaEntities.length, workflows: areaWorkflows.length, questionsAligned };
  });
}

/**
 * Per-area entity guidance for the Discovery-Kit regenerator: an area's
 * interviews must PROBE its ontology entities — how each is created, moved
 * and stored today — so regenerated questions align with the model by
 * construction instead of by hand.
 */
function entitiesByFrameArea(program: ProgramSummary): { areas: string[]; byArea: Map<string, string[]> } {
  const areas = listenCoverageAreas(program).map((area) => area.label);
  const byArea = new Map<string, string[]>();
  for (const entity of recArr(readArtifactDoc(program, "domainOntology")?.entities)) {
    const raw = txt(entity.area);
    const name = txt(entity.name);
    if (!raw || !name) continue;
    // A compound label ("Marketing / Sales") is a SPANNING entity — it feeds
    // the guidance for every area it names, not just its best single match.
    const spanned = new Set(raw.split(/[/&,]+/).map((segment) => segment.trim()).filter(Boolean)
      .map((segment) => canonicalFrameArea(areas, segment)));
    for (const area of spanned) {
      if (!areas.includes(area)) continue;
      byArea.set(area, [...(byArea.get(area) ?? []), name]);
    }
  }
  return { areas, byArea };
}
export function kitAreaEntityGuidance(program: ProgramSummary): string | null {
  const { areas, byArea } = entitiesByFrameArea(program);
  if (!byArea.size) return null;
  return [
    "## Each area's questions must PROBE ITS ENTITIES (from the Domain Ontology)",
    "The interviews covering an area must establish how that area's entities are created, moved and stored today — name them in the questions, in the stakeholders' own vocabulary:",
    ...areas.filter((area) => byArea.has(area)).map((area) => `- ${area}: ${byArea.get(area)!.join(", ")}`),
  ].join("\n");
}

/** The ontology is the ROOT of the Listen triangle: the kit probes its
 * entities and the atlas moves them, and BOTH of those guidances bail out
 * when it is empty. So an ontology that covers one area silently starves the
 * other two — which is why the coverage checklist has to exist here, at the
 * source, and not only downstream.
 *
 * Unlike the kit and atlas guidance this deliberately does NOT depend on
 * existing entities: the case it exists for is the provisional programme that
 * has none yet. */
export function ontologyAreaCoverageGuidance(program: ProgramSummary): string | null {
  // Compound labels ("Marketing / Sales") are spanning tags, not areas to own.
  const areas = listenCoverageAreas(program).map((area) => area.label).filter((label) => !label.includes("/"));
  if (areas.length < 2) return null;
  const { byArea } = entitiesByFrameArea(program);
  const uncovered = areas.filter((area) => !byArea.has(area));
  return [
    "## AREA COVERAGE — the ontology owes an entity to EVERY area the Frame names",
    `This programme's business areas are: ${areas.join(", ")}.`,
    `Each one MUST carry at least one entity in the returned entities array, with that area's label VERBATIM in the entity's "area" field. An area whose interviews have not happened yet still gets its provisional entities — the backbone concepts the steered standard defines for that area's work, evidence "industry-standard practice — to confirm in interviews", plus a gap question naming whom to ask.`,
    // The conservatism rules above are all one-directional (drop, omit,
    // prefer a gap). Without this sentence they read as licence to return an
    // area empty, which is how a nine-area programme ends up with two
    // entities in one area.
    "The conservative rules above decide WHICH noun is admissible for an area. They never license returning an area with no entity at all — an uncovered area is a failed ontology, not a cautious one.",
    ...(uncovered.length ? ["", `Currently UNCOVERED and owed entities: ${uncovered.join(", ")}.`] : []),
  ].join("\n");
}

/** The same per-area entity map for the ATLAS regenerator: an area's
 * workflows must move ITS entities — steps reference them verbatim, and a
 * noun outside the list is an open question, never an invention. */
export function atlasAreaEntityGuidance(program: ProgramSummary): string | null {
  const { areas, byArea } = entitiesByFrameArea(program);
  if (!byArea.size) return null;
  // The abstract AREA COMPLETENESS rule in the system prompt loses to the
  // "one workflow per mandate stage" enumeration — name the areas HERE as a
  // hard checklist so the model can't satisfy the prompt while skipping one.
  const owed = areas.filter((area) => byArea.has(area));
  return [
    "## Each area's workflows must MOVE ITS ENTITIES (from the Domain Ontology)",
    "When mapping an area's workflow, its steps' entities come from that area's list below — reference them VERBATIM in steps[].entities. A noun the list doesn't carry is an openQuestion for that area's stakeholder, never a new entity:",
    ...owed.map((area) => `- ${area}: ${byArea.get(area)!.join(", ")}`),
    "",
    `AREA CHECKLIST — the returned workflows array MUST contain at least one workflow whose area is EACH of: ${owed.join(", ")}. An area with no transcript evidence still gets ONE provisional workflow — an industry-standard 3-6 step skeleton moving that area's entities above, every step's evidence "industry-standard practice — to confirm in interviews", actor = that area's kit persona, plus an openQuestion to them. Do not return an atlas that leaves any listed area workflow-less.`,
  ].join("\n");
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
