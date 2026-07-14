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
  { area: "Legal & Compliance", re: /\b(legal|contract review|complian|regulat|policy|governance|audit|risk assessment)/i },
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

function atlasWorkflows(program: ProgramSummary): Record<string, unknown>[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const atlas = isRecord(inner.currentStateAtlas) ? inner.currentStateAtlas : null;
  return atlas && Array.isArray(atlas.workflows) ? atlas.workflows.filter(isRecord) : [];
}

function ontologyEntities(program: ProgramSummary): Record<string, unknown>[] {
  const raw = (program.rawData ?? {}) as Record<string, unknown>;
  const inner = isRecord(raw.data) ? raw.data : raw;
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  return ontology && Array.isArray(ontology.entities) ? ontology.entities.filter(isRecord) : [];
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

/** The programme's distinct areas — General sorts last, the rest alphabetical.
 * Empty when there's no atlas/ontology yet. */
export function programAreas(program: ProgramSummary): string[] {
  const set = new Set<string>();
  for (const workflow of atlasWorkflows(program)) set.add(workflowArea(workflow));
  for (const entity of ontologyEntities(program)) set.add(entityArea(entity, program));
  return [...set].sort((a, b) => {
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
