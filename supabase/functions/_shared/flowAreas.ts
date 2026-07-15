/**
 * Deterministic business-AREA model for the edge — a faithful, dependency-free
 * port of the client model in `src/v3/components/flow/flowAreas.ts`. The two
 * MUST stay in lockstep: the generator tags experience-design flows and demo
 * scripts with the SAME area the client's `stakeholderPrimaryArea` would assign,
 * so the Show demo surface can default a recipient to their own area's flow and
 * name it — exactly as the Listen review surfaces already scope by area.
 *
 * Deno can't import the client module (it pulls React and `@/`-alias runtime
 * deps), so the keyword table and scoring are re-stated here. When you change
 * one, change the other; the client test-suite (flowLibs.test.ts) pins the
 * canonical behaviour.
 */

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);
const str = (value: unknown): string => (typeof value === "string" ? value : "");

export const GENERAL_AREA = "General";

// Canonical areas + the words that place a workflow/entity/person in them. Order
// is priority: the first match wins. Leading \b anchors each keyword to a word
// start with NO trailing boundary, so stems match. Keep in lockstep with the
// AREA_KEYWORDS table in the client flowAreas.ts.
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

/** The area a workflow belongs to — explicit `area`, else inferred from its
 * name/owner/actors, else General. */
function workflowArea(workflow: Record<string, unknown>): string {
  const explicit = str(workflow.area).trim();
  if (explicit) return explicit;
  const actors = Array.isArray(workflow.steps)
    ? workflow.steps.filter(isRecord).map((s) => str(s.actor)).join(" ") : "";
  return inferArea(`${str(workflow.name)} ${str(workflow.owner)} ${actors}`) ?? GENERAL_AREA;
}

/** The area an ontology entity belongs to — explicit `area`, else inferred from
 * its name/definition, else from a workflow that touches it, else General. */
function entityArea(entity: Record<string, unknown>, workflows: Record<string, unknown>[]): string {
  const explicit = str(entity.area).trim();
  if (explicit) return explicit;
  const direct = inferArea(`${str(entity.name)} ${str(entity.definition)}`);
  if (direct) return direct;
  const name = str(entity.name).trim().toLowerCase();
  if (name) {
    for (const workflow of workflows) {
      const touches = Array.isArray(workflow.steps) && workflow.steps.filter(isRecord)
        .some((s) => (Array.isArray(s.entities) ? s.entities.map(str) : []).some((e) => e.trim().toLowerCase() === name));
      if (touches) return workflowArea(workflow);
    }
  }
  return GENERAL_AREA;
}

/** The programme's distinct areas — General sorts last, the rest alphabetical. */
function programAreas(workflows: Record<string, unknown>[], entities: Record<string, unknown>[]): string[] {
  const set = new Set<string>();
  for (const workflow of workflows) set.add(workflowArea(workflow));
  for (const entity of entities) set.add(entityArea(entity, workflows));
  return [...set].sort((a, b) => {
    if (a === GENERAL_AREA) return 1;
    if (b === GENERAL_AREA) return -1;
    return a.localeCompare(b);
  });
}

// Token overlap between a roster label and an Atlas actor — ignores short/common
// stop tokens so "the Manager" doesn't match everything. Keep in lockstep with
// the client AREA_STOP_TOKENS / labelsOverlap.
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

/**
 * The single area a person is filed under — scores each atlas area by how well
 * the person matches its workflows' actors (exact actor equality heaviest, then
 * their role keyword aligned to an area, then fuzzy actor-token overlap) and
 * files them under the top area. A faithful port of the client's
 * `stakeholderPrimaryArea`; used to tag each experience-design flow (by persona)
 * and each demo script (by stakeholder/role) with its area.
 */
export function stakeholderPrimaryArea(
  workflows: Record<string, unknown>[],
  entities: Record<string, unknown>[],
  name: string,
  role?: string,
): string {
  const labels = [role, name].filter((v): v is string => !!v && v.trim().length > 0).map((v) => v.trim().toLowerCase());
  if (!labels.length) return GENERAL_AREA;
  const areas = programAreas(workflows, entities);
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
  // The person's TITLE usually names their domain directly — match the role/name
  // against each real area LABEL so a Discovery-Kit-only area still gets a lane.
  for (const area of areas) {
    if (area === GENERAL_AREA) continue;
    const segments = area.includes("/") ? area.split("/").map((s) => s.trim()).filter(Boolean) : [area];
    for (const label of labels) {
      for (const segment of segments) {
        if (labelsOverlap(segment, label)) { bump(segment, 8); break; }
      }
    }
  }
  // The person's own role keyword, aligned to the area that shares it.
  const inferred = inferArea(`${role ?? ""} ${name}`);
  if (inferred) for (const area of areas) {
    if (area === inferred || labelsOverlap(area, inferred)) bump(area, 6);
  }
  let best = GENERAL_AREA;
  let top = 0;
  for (const [area, sc] of score) if (sc > top) { top = sc; best = area; }
  if (top === 0 && inferred) return inferred;
  return best;
}
