/**
 * THE ATLAS ALREADY KNOWS WHO DOES THE WORK.
 *
 * A current-state atlas states, per workflow, an OWNER and a sequence of steps
 * each carrying an ACTOR, the system they do it in, and the entities they touch.
 * That is a persona and its work surface, written down — and the prototype threw
 * all of it away: it assembled one list screen and one detail screen per entity
 * and nothing that belonged to a person. The free-form path's twelve fabricated
 * dashboards were reaching for exactly this and had to invent it, because the
 * derived path offered nothing to reach for.
 *
 * So the roles are DERIVED, once, here: pure, no clock, no RNG, ordered by first
 * appearance in the atlas so the same atlas always yields the same workbenches
 * in the same order.
 *
 * WHAT COUNTS AS A ROLE. A workflow's owner, or — when it names none — the actor
 * of its first step. That is the person the workflow belongs to. Every OTHER
 * actor inside those workflows is a collaborator, and is carried on the
 * workbench rather than dropped: an actor who appears only mid-workflow is a
 * handoff, which is a fact about the role's work, not a second role. Between the
 * two, every name the atlas states about who does what stays visible.
 *
 * It lives beside the fabric rather than inside it because it must not move
 * `fabric.version`: the seed is keyed by that hash, so deriving personas into
 * fabric nodes would re-roll every seeded value in every build for a derivation
 * that changes no structure the seed depends on.
 */

const slug = (s: unknown): string =>
  String(s ?? "").trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "") || "x";

const text = (v: unknown): string => (typeof v === "string" ? v.trim() : v == null ? "" : String(v).trim());

const strings = (v: unknown): string[] =>
  (Array.isArray(v) ? v : []).map(text).filter(Boolean);

export interface AtlasStep {
  action: string;
  actor: string;
  system: string;
  /** Entities the step names — as the ATLAS names them, un-matched. Resolving
   *  them against the ontology is the caller's job, and the ones that resolve to
   *  nothing are the caller's gap to state. */
  entities: string[];
}

export interface AtlasWorkflow {
  name: string;
  slug: string;
  area: string;
  owner: string;
  trigger: string;
  steps: AtlasStep[];
  handoffs: string[];
  /**
   * Position among the atlas's NAMED workflows — the same enumeration
   * `deriveFabric` walks to mint its `flow:` nodes. Carried so a caller can pair
   * a workbench's workflow with the fabric node that stands for it without
   * re-deriving the slug (and without duplicating the collision suffix the
   * fabric's uniquifier applies to two workflows of the same name).
   */
  index: number;
}

export interface AtlasRole {
  /** The role as the atlas wrote it. */
  role: string;
  slug: string;
  /** Workflows this role owns, in atlas order. */
  workflows: AtlasWorkflow[];
  /** Entities named by the steps of those workflows, first-mention order, as
   *  the atlas names them. */
  entities: string[];
  /** Systems those steps are performed in, first-mention order. */
  systems: string[];
  /** The job titles named on these steps — who actually does the work in this
   *  area, and the roles it hands off to. Dropped `ownSteps` with the move to
   *  areas: it counted steps whose actor equalled the GROUP NAME, which meant
   *  something when the group was a job title and nothing once it is an area.
   *  Nothing read it. */
  collaborators: string[];
}

/** The workflows the atlas holds, normalised. The enumeration matches
 *  `deriveFabric`'s: a workflow with no name is skipped by both, so `index`
 *  lines up with the fabric's `flow:` nodes. */
export function atlasWorkflows(atlas: unknown): AtlasWorkflow[] {
  const a = (typeof atlas === "object" && atlas !== null && !Array.isArray(atlas)) ? atlas as Record<string, unknown> : {};
  const raw = Array.isArray(a.workflows) ? a.workflows as unknown[] : [];
  const out: AtlasWorkflow[] = [];
  for (const w of raw) {
    const rec = (typeof w === "object" && w !== null && !Array.isArray(w)) ? w as Record<string, unknown> : {};
    // The same emptiness test the fabric applies, so the two enumerations cannot
    // drift: a workflow the fabric mints a node for is a workflow that is here.
    if (!String(rec.name ?? "")) continue;
    const steps: AtlasStep[] = (Array.isArray(rec.steps) ? rec.steps : []).map((s) => {
      const st = (typeof s === "object" && s !== null && !Array.isArray(s)) ? s as Record<string, unknown> : {};
      return {
        action: text(st.action) || text(st.name),
        actor: text(st.actor),
        system: text(st.system),
        entities: strings(st.entities),
      };
    });
    out.push({
      name: text(rec.name) || String(rec.name ?? ""),
      slug: slug(rec.name),
      area: text(rec.area),
      owner: text(rec.owner),
      trigger: text(rec.trigger),
      steps,
      handoffs: strings(rec.handoffs),
      index: out.length,
    });
  }
  return out;
}

/**
 * A ROLE IS A JOB, NOT A CONSULTING CREDENTIAL.
 *
 * The discovery kit casts its interviewees as "Marketing SME", "Sales SME" —
 * correct for an engagement roster, where SME distinguishes the person we
 * interviewed from the department. The atlas inherits those names as workflow
 * owners, and the prototype rendered them verbatim, so a client's own product
 * showed them a sidebar of SMEs: a word from our methodology, describing them,
 * on a screen that is supposed to be theirs. Nobody in a marketing team calls
 * their desk "the Marketing SME workbench".
 *
 * Only the trailing credential is dropped, never a real title: "Sales
 * Operations SME" becomes "Sales Operations", while "Executive Sponsor" (no
 * credential) is untouched. A name that is ONLY the credential keeps it, since
 * "" names nobody.
 */
const ROLE_CREDENTIAL = /[\s,–—-]*\(?\b(smes?|subject[\s-]matter[\s-]experts?|poc|sme lead)\b\)?[\s.]*$/i;
export function businessRole(name: unknown): string {
  const raw = text(name);
  if (!raw) return "";
  const trimmed = raw.replace(ROLE_CREDENTIAL, "").trim();
  return trimmed || raw;
}

/** The role a workflow belongs to: its owner, else the actor who starts it —
 *  as a job title, with any consulting credential dropped. Still the answer to
 *  "who owns this workflow"; no longer the answer to "which workbench". */
export function roleOf(workflow: AtlasWorkflow): string {
  return businessRole(workflow.owner || workflow.steps.find((s) => s.actor)?.actor || "");
}

/**
 * THE AREA A WORKBENCH IS, which is not the same question as who owns a
 * workflow (operator direction).
 *
 * Grouping by owner made a menu of job titles — "Sales reps - Markets", "GTM -
 * Practices", "Executive Sponsor" — three of which were the same part of the
 * business seen from three engagements, and one of which was a person. A
 * workbench is a PLACE THE WORK HAPPENS, and the atlas already states it: every
 * workflow carries `area`, and on the measured atlas those areas are Marketing,
 * Sales, Finance, Delivery — the words the client uses for their own business.
 *
 * The owner is the fallback, not the discard: a workflow the atlas gives no
 * area still has to land somewhere, and the role that runs it is the truest
 * thing left to say about where it belongs.
 */
export function areaOf(workflow: AtlasWorkflow): string {
  return text(workflow.area) || roleOf(workflow);
}

/**
 * The atlas's AREAS, each with the work that belongs to it.
 *
 * A workflow the atlas attributes to nobody is NOT dropped: it lands under an
 * empty name, and the caller renders that as the open question it is ("who runs
 * this?") rather than as a workflow that does not exist.
 */
export function deriveWorkbenches(atlas: unknown): AtlasRole[] {
  const workflows = atlasWorkflows(atlas);
  const byRole = new Map<string, AtlasRole>();
  const order: string[] = [];
  for (const w of workflows) {
    const role = areaOf(w);
    let entry = byRole.get(role);
    if (!entry) {
      entry = { role, slug: slug(role || "unattributed"), workflows: [], entities: [], systems: [], collaborators: [] };
      byRole.set(role, entry);
      order.push(role);
    }
    entry.workflows.push(w);
    for (const s of w.steps) {
      for (const e of s.entities) if (!entry.entities.includes(e)) entry.entities.push(e);
      if (s.system && !entry.systems.includes(s.system)) entry.systems.push(s.system);
      // The actors on these steps, as job titles — otherwise the header says
      // "Marketing" and the line beneath it says "Marketing SME". An actor whose
      // title IS the area name adds nothing to a list headed by that area.
      const actor = businessRole(s.actor);
      if (actor && actor !== role && !entry.collaborators.includes(actor)) entry.collaborators.push(actor);
    }
  }
  // Two areas whose names differ only by their slug would collide in the URL and
  // in `data-screen`; suffix the later one rather than let one screen shadow the
  // other. Ordered by first appearance, so the suffix is deterministic.
  const seen = new Map<string, number>();
  for (const role of order) {
    const entry = byRole.get(role)!;
    const n = seen.get(entry.slug) ?? 0;
    seen.set(entry.slug, n + 1);
    if (n > 0) entry.slug = `${entry.slug}-${n + 1}`;
  }
  return order.map((r) => byRole.get(r)!);
}
