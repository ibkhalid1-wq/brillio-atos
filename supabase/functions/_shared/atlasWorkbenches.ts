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
  /** Other actors inside this role's workflows — the handoffs. */
  collaborators: string[];
  /** How many steps this role personally performs across its workflows. */
  ownSteps: number;
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

/** The role a workflow belongs to: its owner, else the actor who starts it. */
export function roleOf(workflow: AtlasWorkflow): string {
  return workflow.owner || workflow.steps.find((s) => s.actor)?.actor || "";
}

/**
 * The atlas's roles, each with the work that belongs to it.
 *
 * A workflow the atlas attributes to nobody is NOT dropped: it lands under an
 * empty role name, and the caller renders that as the open question it is
 * ("who runs this?") rather than as a workflow that does not exist.
 */
export function deriveWorkbenches(atlas: unknown): AtlasRole[] {
  const workflows = atlasWorkflows(atlas);
  const byRole = new Map<string, AtlasRole>();
  const order: string[] = [];
  for (const w of workflows) {
    const role = roleOf(w);
    let entry = byRole.get(role);
    if (!entry) {
      entry = { role, slug: slug(role || "unattributed"), workflows: [], entities: [], systems: [], collaborators: [], ownSteps: 0 };
      byRole.set(role, entry);
      order.push(role);
    }
    entry.workflows.push(w);
    for (const s of w.steps) {
      for (const e of s.entities) if (!entry.entities.includes(e)) entry.entities.push(e);
      if (s.system && !entry.systems.includes(s.system)) entry.systems.push(s.system);
      if (s.actor && s.actor !== role && !entry.collaborators.includes(s.actor)) entry.collaborators.push(s.actor);
      if (!s.actor || s.actor === role) entry.ownSteps += 1;
    }
  }
  // Two roles whose names differ only by their slug would collide in the URL and
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
