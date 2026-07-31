/**
 * Business AREAS (tracks) — the unit of parallelism.
 *
 * An area groups the Atlas workflows and Ontology entities of one business
 * domain (Sales, Marketing, Patient Enrollment, …). It's what lets Marketing
 * advance to Envision/Show while Sales is still in Listen, and it drives the
 * area filters on the stakeholder review surfaces.
 *
 * The generators tag workflows/entities with an explicit `area`; where that's
 * missing (existing records), we infer one deterministically from the
 * workflow/entity name so the filters and grouping still work — the explicit
 * field always wins once a regeneration sets it.
 */
import type { ProgramSummary } from "@/new/types";
import { flowMovements, movementEvidence, demoAcceptance, readMovementInputs } from "@/v3/components/flow/flowShellData";

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const GENERAL_AREA = "General";

// Canonical areas + the words that place a workflow/entity in them. Order is
// priority: the first match wins (more specific domains before generic ones).
// Leading \b anchors each keyword to a word start; there is deliberately NO
// trailing boundary, so stems match ("opportunit"→opportunity, "financ"→
// financial, "lead qual"→lead qualification).
const AREA_KEYWORDS: Array<{ area: string; re: RegExp }> = [
  { area: "Clinical", re: /\b(clinical|patient|trial|enroll|protocol|screening|informed consent|adverse event)/i },
  { area: "Sales", re: /\b(sales|quote|deal|pipeline|opportunit|account executive|lead qual|proposal|contract negotiat|cpq|order booking)/i },
  { area: "Marketing", re: /\b(market|campaign|lead gen|demand gen|content|brand|seo|advertis|nurtur|webinar)/i },
  { area: "Finance", re: /\b(financ|invoic|billing|payment|revenue|accounts payable|accounts receivable|ledger|collections|budget|reconcil)/i },
  { area: "People", re: /\b(hr\b|human resource|recruit|hiring|onboard|talent|employee|payroll|people ops)/i },
  { area: "Legal & Compliance", re: /\b(legal|contract review|complian|regulat|policy|governance|audit|risk assessment|privacy|consent|data protection|gdpr|hipaa|ethics|informed consent)/i },
  { area: "Support", re: /\b(support|ticket|customer service|help ?desk|case management|escalation|service request)/i },
  { area: "Operations", re: /\b(operations|fulfil|logistics|supply|inventory|procurement|warehouse|dispatch|manufactur)/i },
  { area: "Product & Engineering", re: /\b(product|engineering|develop|release|deploy|feature|sprint|backlog)/i },
];

/** Deterministically classify free text into a canonical area, or null. */
export function inferArea(text: string): string | null {
  const t = str(text);
  for (const { area, re } of AREA_KEYWORDS) if (re.test(t)) return area;
  return null;
}

/** An operator-declared correction to a synthesized role: rename it and/or pin
 * it to a business area. Keyed by the normalized ORIGINAL role. This is how "the
 * Customer Success role is called Vertical Sales and maps to Sales" becomes
 * durable data the whole spine honors — surviving regeneration — rather than a
 * free-text note the discovery-kit generator ignores. Stored on Listen inputs
 * (`_roleAliases`), the same place `_roleBindings` lives. */
export interface RoleAlias { rename?: string; area?: string; from?: string; }
/** Normalized role-alias key — case/punctuation-insensitive. */
export const roleAliasKey = (role: string): string =>
  role.trim().toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
export function readRoleAliases(program: ProgramSummary): Record<string, RoleAlias> {
  const raw = readMovementInputs(program, "listen")._roleAliases;
  let obj: unknown = raw;
  if (typeof raw === "string") { try { obj = JSON.parse(raw); } catch { return {}; } }
  if (!isRecord(obj)) return {};
  const out: Record<string, RoleAlias> = {};
  for (const [key, value] of Object.entries(obj)) {
    if (!isRecord(value)) continue;
    const rename = str(value.rename).trim();
    const area = str(value.area).trim();
    const from = str(value.from).trim();
    if (rename || area) out[key] = { rename: rename || undefined, area: area || undefined, from: from || undefined };
  }
  return out;
}
/** The alias for a specific role, if one is on record. */
export function roleAliasFor(program: ProgramSummary, role: string | undefined): RoleAlias | null {
  if (!role || !role.trim()) return null;
  return readRoleAliases(program)[roleAliasKey(role)] ?? null;
}
/** The display label for a role — its operator-declared rename, else itself. */
export function displayRole(program: ProgramSummary, role: string): string {
  return roleAliasFor(program, role)?.rename || role;
}

export function atlasWorkflows(program: ProgramSummary): Record<string, unknown>[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : null;
  return atlas && Array.isArray(atlas.workflows) ? atlas.workflows.filter(isRecord) : [];
}

export function ontologyEntities(program: ProgramSummary): Record<string, unknown>[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  return ontology && Array.isArray(ontology.entities) ? ontology.entities.filter(isRecord) : [];
}

/** The ontology's relationship edges — the sibling `relations` array the graph
 * editor (OntologyStudio) and generator use, each `{ from, to, label|type }`
 * referencing entity names. Separate from any `relationships` some entities
 * nest inline. */
export function ontologyRelations(program: ProgramSummary): Record<string, unknown>[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  return ontology && Array.isArray(ontology.relations) ? ontology.relations.filter(isRecord) : [];
}

/** The area a workflow belongs to — explicit `area`, else inferred from its
 * name and actors, else General. */
export function workflowArea(workflow: Record<string, unknown>): string {
  const explicit = str(workflow.area).trim();
  if (explicit) return explicit;
  const actors = Array.isArray(workflow.steps)
    ? workflow.steps.filter(isRecord).map((s) => str(s.actor)).join(" ") : "";
  return inferArea(`${str(workflow.name)} ${str(workflow.owner)} ${actors}`) ?? GENERAL_AREA;
}

/** The area an ontology entity belongs to — explicit `area`, else inferred from
 * its name/definition, else from a workflow that touches it, else General. */
export function entityArea(entity: Record<string, unknown>, program: ProgramSummary): string {
  const explicit = str(entity.area).trim();
  if (explicit) return explicit;
  const direct = inferArea(`${str(entity.name)} ${str(entity.definition)}`);
  if (direct) return direct;
  const name = str(entity.name).trim().toLowerCase();
  if (name) {
    for (const workflow of atlasWorkflows(program)) {
      const touches = Array.isArray(workflow.steps) && workflow.steps.filter(isRecord)
        .some((s) => (Array.isArray(s.entities) ? s.entities.map(str) : []).some((e) => e.trim().toLowerCase() === name));
      if (touches) return workflowArea(workflow);
    }
  }
  return GENERAL_AREA;
}

/** The business domains the Discovery Kit declared it would cover — the
 * "what we'll cover" areas, stored on discoveryKit.coverageMap[].domain. These
 * are the SOURCE OF TRUTH the phases align to: they carry forward even before a
 * Listen workflow or ontology term happens to name that domain. */
/** The Discovery Kit's coverage map as rows: which DOMAIN each set of people
 * was assigned to cover. The kit is where an operator actually states "Vimal
 * Pandey covers Finance", so anything downstream that asks "who covers this
 * area?" has to read it — inferring the answer from another phase's artefacts
 * gets a different, and often empty, result. */
export function kitCoverageRows(program: ProgramSummary): Array<{ domain: string; coveredBy: string[] }> {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : null;
  const map = kit && Array.isArray(kit.coverageMap) ? kit.coverageMap.filter(isRecord) : [];
  return map.map((row) => ({
    domain: str(row.domain).trim(),
    coveredBy: (Array.isArray(row.coveredBy) ? row.coveredBy.map(String) : str(row.coveredBy).split(","))
      // "End Patient — TBC" and "End Patient" are one identity; the kit writes
      // both forms, and the same strip is applied wherever coveredBy is read.
      .map((v) => v.trim().replace(/\s*[—–−‑-]\s*tbc\s*$/i, "").trim())
      .filter(Boolean),
  })).filter((r) => r.domain && r.coveredBy.length);
}

export function kitCoverageDomains(program: ProgramSummary): string[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const kit = isRecord(inner.discoveryKit) ? inner.discoveryKit : null;
  const map = kit && Array.isArray(kit.coverageMap) ? kit.coverageMap.filter(isRecord) : [];
  return map.map((row) => str(row.domain).trim()).filter(Boolean);
}

/** Normalized area identity — case/punctuation-insensitive, so "Sales &
 * Marketing" and "sales and marketing" collapse to one key. */
export const areaKey = (area: string): string =>
  area.toLowerCase().replace(/\band\b|&/g, " ").replace(/[^a-z0-9]+/g, " ").trim();

/** The programme's distinct areas — General sorts last, the rest alphabetical.
 * Unions the modeled areas (Atlas workflows + Ontology entities) with the
 * Discovery Kit's declared coverage domains, so the kit's "what we'll cover"
 * aligns every downstream phase. A domain already modeled (same normalized
 * label) is not duplicated — the modeled label wins. */
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

export function programAreas(program: ProgramSummary): string[] {
  const byKey = new Map<string, string>();
  const add = (label: string) => {
    const l = label.trim();
    if (!l) return;
    const k = areaKey(l);
    if (!k || byKey.has(k)) return;
    byKey.set(k, l);
  };
  // The KIT's vocabulary is authoritative — its domains are what the operator
  // agreed to cover, and kitCoverageDomains above calls them the source of
  // truth the phases align to. Modelled labels used to be added first and win,
  // which contradicted that: the ontology writing "Pre-Operative Care" beside a
  // kit domain of "Pre-Op Nursing" produced TWO areas for one, and Discovery,
  // the ontology and the atlas each ended up naming areas the kit had never
  // heard of.
  //
  // So the kit's domains land first, and a modelled label is canonicalised onto
  // them. A label that matches nothing still stands on its own — a genuinely
  // new area the model found must not be swallowed. Compound spanning tags
  // ("Finance / Sales / Practices") are left alone; they are not areas.
  const kitDomains = kitCoverageDomains(program);
  for (const domain of kitDomains) add(domain);
  const align = (raw: string): string => {
    if (!kitDomains.length || !raw || raw.includes("/")) return raw;
    const canon = canonicalFrameArea(kitDomains, raw);
    return canon === GENERAL_AREA && areaKey(raw) !== areaKey(GENERAL_AREA) ? raw : canon;
  };
  for (const workflow of atlasWorkflows(program)) add(align(workflowArea(workflow)));
  for (const entity of ontologyEntities(program)) add(align(entityArea(entity, program)));
  return [...byKey.values()].sort((a, b) => {
    if (a === GENERAL_AREA) return 1;
    if (b === GENERAL_AREA) return -1;
    return a.localeCompare(b);
  });
}

/** True when the programme has more than one area — the point at which area
 * filters and parallel per-area work start to matter. */
export function hasMultipleAreas(program: ProgramSummary): boolean {
  return programAreas(program).length > 1;
}

/** The areas a persona (Atlas actor) works in — the areas of the workflows
 * whose steps they own. */
export function personaAreas(program: ProgramSummary, persona: string): string[] {
  const key = persona.trim().toLowerCase();
  if (!key) return [];
  const set = new Set<string>();
  for (const workflow of atlasWorkflows(program)) {
    const acts = Array.isArray(workflow.steps) && workflow.steps.filter(isRecord)
      .some((s) => str(s.actor).trim().toLowerCase() === key);
    if (acts) set.add(workflowArea(workflow));
  }
  return [...set];
}

/** Token overlap between a roster label and an Atlas actor — "Enrollment Lead"
 * finds the actor "Enrollment Coordinator" on the shared "enrollment" token, so
 * named people map to the area their role acts in even when the strings differ.
 * Ignores short/common stop tokens so "the Manager" doesn't match everything. */
const AREA_STOP_TOKENS = new Set(["the", "and", "for", "lead", "team", "senior", "junior", "head", "chief", "officer", "manager", "director", "specialist", "analyst", "associate", "coordinator", "representative", "rep", "exec", "executive"]);
function labelTokens(text: string): Set<string> {
  return new Set(text.toLowerCase().split(/[^a-z0-9]+/)
    .map((token) => token.replace(/s$/, ""))
    .filter((token) => token.length >= 3 && !AREA_STOP_TOKENS.has(token)));
}
function labelsOverlap(a: string, b: string): boolean {
  const ta = labelTokens(a);
  const tb = labelTokens(b);
  if (!ta.size || !tb.size) return false;
  for (const token of tb) if (ta.has(token)) return true;
  return false;
}

/** The single area a stakeholder is filed under on the collection board. Scores
 * each atlas area by how well the person matches its workflows' actors — exact
 * actor equality weighs heaviest, then the person's own role keyword aligned to
 * an atlas area, then a fuzzy actor-token overlap — and files them under the top
 * area. Keeps a person in exactly ONE lane so no card is ever listed twice.
 * Scoring (not first-match) stops a Sales SME landing in a Marketing workflow
 * that merely happens to include a sales actor. */
export function stakeholderPrimaryArea(program: ProgramSummary, name: string, role?: string): string {
  // An operator-declared role→area remap wins over everything — it's a
  // deliberate correction ("the Customer Success role maps to Sales"). Check the
  // role AND the name, since a synthesized "role" sometimes arrives as the name.
  const alias = roleAliasFor(program, role) ?? roleAliasFor(program, name);
  if (alias?.area) return alias.area;
  const workflows = atlasWorkflows(program);
  const labels = [role, name].filter((v): v is string => !!v && v.trim().length > 0).map((v) => v.trim().toLowerCase());
  if (!labels.length) return GENERAL_AREA;
  const score = new Map<string, number>();
  const bump = (area: string, n: number) => score.set(area, (score.get(area) ?? 0) + n);
  for (const workflow of workflows) {
    const area = workflowArea(workflow);
    const steps = Array.isArray(workflow.steps) ? workflow.steps.filter(isRecord) : [];
    for (const step of steps) {
      const actor = str(step.actor).trim();
      if (!actor) continue;
      for (const label of labels) {
        if (actor.toLowerCase() === label) bump(area, 10);
        else if (labelsOverlap(actor, label)) bump(area, 2);
      }
    }
  }
  // The person's TITLE usually names their domain directly ("Talent Acquisition
  // SME" → the "Talent" area, "Marketing SME" → "Marketing"). Match the role/name
  // against each real area LABEL — a strong signal that survives when the atlas
  // has no workflow for that area yet, so a Discovery-Kit-only area still gets
  // its own lane instead of the person falling into General. Compound labels
  // ("Alliances/Marketing/Talent") score toward the matched clean segment.
  for (const area of programAreas(program)) {
    if (area === GENERAL_AREA) continue;
    const segments = area.includes("/") ? area.split("/").map((s) => s.trim()).filter(Boolean) : [area];
    for (const label of labels) {
      for (const segment of segments) {
        if (labelsOverlap(segment, label)) { bump(segment, 8); break; }
      }
    }
  }
  // The person's own role keyword, aligned to the area that shares it (canonical
  // "Legal & Compliance" → the atlas's "Legal").
  const inferred = inferArea(`${role ?? ""} ${name}`);
  if (inferred) for (const area of programAreas(program)) {
    if (area === inferred || labelsOverlap(area, inferred)) bump(area, 6);
  }
  let best = GENERAL_AREA;
  let top = 0;
  for (const [area, sc] of score) if (sc > top) { top = sc; best = area; }
  // Nothing in the ontology/atlas claimed this person. Fall back to the domain
  // their own role names ("Regulatory Affairs Lead" → Legal & Compliance,
  // "Data Privacy Officer" → Legal & Compliance) so a THIN ontology — one that
  // hasn't tagged areas yet, like an early clinical programme — still files
  // each voice under a real business area instead of collapsing to General.
  // The ontology/atlas-grounded matches above always win when they exist.
  if (top === 0 && inferred) return inferred;
  return best;
}

/** True when an area has substantial current-state coverage on the record — at
 * least two of its workflows are captured on the Atlas. Used to treat a
 * discovery agenda as ADDRESSED for that area's SME even when the evidence names
 * no individual (a bulk document, a whole-team transcript): the area IS modelled,
 * so we stop re-asking the planned agenda. Still-open items (contradictions,
 * routed asks, artifact gaps) stay on their script — only the agenda clears. */
export function areaHasModel(program: ProgramSummary, area: string): boolean {
  if (!area || area === GENERAL_AREA) return false;
  // "Modelled" = the area is on the Atlas AND in the Ontology (≥1 workflow AND
  // ≥1 term). Even a thin footprint means the captured evidence produced a
  // current-state model for the area — enough to treat that area's discovery
  // agenda as addressed. An area with no workflow or no term isn't modelled yet.
  const hasWorkflow = atlasWorkflows(program).some((w) => workflowArea(w) === area);
  if (!hasWorkflow) return false;
  return ontologyEntities(program).some((e) => entityArea(e, program) === area);
}

/** True when this area's model was produced by EVIDENCE — at least one voice in
 * it is on record — rather than merely generated.
 *
 * areaHasModel answers "is this area mapped?", which is the right question for
 * a badge and the wrong one for deciding whether to stop asking. The
 * provisional path now generates an ontology and an atlas from published
 * standards BEFORE any conversation happens, so a fully "mapped" area can sit
 * at zero voices heard. Anything that suppresses work on the grounds that the
 * record already holds the answer has to ask this instead.
 */
export function areaHasEvidence(program: ProgramSummary, area: string): boolean {
  if (!area || area === GENERAL_AREA) return false;
  return (areaProgress(program).find((r) => r.area === area)?.heard.length ?? 0) > 0;
}

/** The areas whose Listen voices are all heard — ready to move to Envision/Show
 * while other areas keep collecting. */
export function readyAreas(program: ProgramSummary): Set<string> {
  return new Set(areaProgress(program).filter((r) => r.listenReady).map((r) => r.area));
}

/** True when a persona may start Envision/Show — their area's Listen voices are
 * all heard. Ungated (always true) for a single-area programme or a persona
 * with no area yet, so the gate never strands anyone. */
export function personaReadyToAdvance(program: ProgramSummary, persona: string): boolean {
  if (!hasMultipleAreas(program)) return true;
  const areas = personaAreas(program, persona);
  if (!areas.length) return true;
  const ready = readyAreas(program);
  return areas.some((area) => ready.has(area));
}

export interface AreaProgress {
  area: string;
  workflows: number;
  entities: number;
  /** The distinct Atlas actors who own steps in this area. */
  personas: string[];
  /** …of whom these have Listen evidence on record. */
  heard: string[];
  /** Every persona in the area is heard — the area is ready to move to Envision
   * while other areas are still collecting. */
  listenReady: boolean;
  /** Stakeholders across the programme who have accepted their demo (Show). */
  demosAccepted: number;
  demosTotal: number;
}

/**
 * Per-area progress — the parallel-work view. An area whose voices are all
 * heard is ready to Envision and Show even while other areas keep collecting.
 */
export function areaProgress(program: ProgramSummary): AreaProgress[] {
  const workflows = atlasWorkflows(program);
  const entities = ontologyEntities(program);
  const listen = flowMovements().find((m) => m.id === "listen");
  const evidence = listen ? movementEvidence(program, listen) : [];
  const isHeard = (persona: string): boolean => {
    const key = persona.trim().toLowerCase();
    if (key.length < 3) return false;
    return evidence.some((e) => {
      const first = e.who.split(",")[0].trim().toLowerCase();
      return first === key || (first.length > 2 && (first.includes(key) || key.includes(first)));
    });
  };
  const demo = demoAcceptance(program);
  return programAreas(program).map((area) => {
    const areaWf = workflows.filter((w) => workflowArea(w) === area);
    const areaEnt = entities.filter((e) => entityArea(e, program) === area);
    const personaSet = new Set<string>();
    for (const w of areaWf) {
      for (const s of (Array.isArray(w.steps) ? w.steps.filter(isRecord) : [])) {
        const actor = str(s.actor).trim();
        if (actor) personaSet.add(actor);
      }
    }
    const personas = [...personaSet];
    const heard = personas.filter(isHeard);
    return {
      area,
      workflows: areaWf.length,
      entities: areaEnt.length,
      personas,
      heard,
      listenReady: personas.length > 0 && heard.length >= personas.length,
      demosAccepted: demo.accepted,
      demosTotal: demo.total,
    };
  });
}
