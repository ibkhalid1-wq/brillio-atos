/**
 * THE DESIGNED VERBS, MADE REAL — or refused.
 *
 * Experience Design authors `primaryActions` per screen ("Accept Lead",
 * "Convert to Opportunity", "Assign Sales Rep", "Send Offer", "Update
 * Pipeline") and `workflowMachines` whose transitions name a trigger and the
 * state it moves to. The assembler read NONE of it: every screen offered the
 * same Open / Edit / Delete / New, so the one part of the design that says what
 * the business actually DOES with a record was the part the prototype dropped.
 *
 * The rule this module exists to keep is the fabric's own: A CONTROL THAT
 * CANNOT ACT IS NOT DRAWN. So each authored verb is resolved against what the
 * ontology can honestly support, and only three shapes survive:
 *
 *   · `set`    — the verb (or a machine transition triggered by it) moves the
 *                record to a state the entity's own status attribute LISTS.
 *                The button writes that value. "End Campaign" → the Campaign
 *                machine's transition to "Completed" → campaignStatus holds
 *                "Completed" → wired.
 *   · `create` — the verb names another entity this ontology holds and this
 *                build gives a screen. The button opens that entity's new-record
 *                form. "Send Offer" → Offer exists → wired.
 *   · `assign` — the verb assigns, and the entity carries a person-shaped
 *                attribute to assign into. The button opens the record's edit
 *                form, where that field is.
 *
 * Everything else is REFUSED and named — "Accept Lead" where no lead stage is
 * called accepted and no machine transition is triggered by it; "Update
 * Pipeline" where the ontology holds no Pipeline. A refusal is a finding for
 * the operator (and a real question for the interview: *is* there an accepted
 * state?), never a button that shrugs.
 *
 * MACHINE STATES ARE NOT ONTOLOGY VALUES. Measured on a real programme: the
 * "Lead to Opportunity" machine runs Lead Accepted → Opportunity Created →
 * In Progress → Offer Sent → Closed, while the ontology's `leadStage` holds
 * New / Qualifying / Converted / Disqualified. The two vocabularies are
 * authored by different agents against different sources, so a transition is
 * only wired where its target state is a value the record can actually hold —
 * which is exactly why this resolves against the ontology and not the machine.
 *
 * Pure and clockless: same design + same ontology → same actions, byte for byte.
 */

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const asRecords = (v: unknown): Array<Record<string, unknown>> =>
  Array.isArray(v) ? v.filter(isRecord) : [];

const asString = (v: unknown): string => (typeof v === "string" ? v.trim() : "");

/** Comparison key: case- and punctuation-insensitive, so "Closed Won",
 *  "closed-won" and "CLOSEDWON" are one value. */
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]+/g, "");

/** The words of a label, for entity-name matching inside a phrase. */
const words = (s: string): string[] => s.toLowerCase().split(/[^a-z0-9]+/).filter(Boolean);

export type ScreenActionKind = "set" | "create" | "assign";

export interface ScreenAction {
  /** The designer's own label, verbatim — this is what the button says. */
  label: ScreenActionKind extends never ? never : string;
  kind: ScreenActionKind;
  /** `set`: the attribute written, and the value written into it. */
  attribute?: string;
  value?: string;
  /** `create`: the entity whose form opens. */
  target?: string;
  /** Where the control belongs: a `create` needs no record, the others act on one. */
  scope: "record" | "list";
  /** Why this is honest, in one line — carried to the title attribute so a
   *  reviewer can see the grounding without opening the design. */
  basis: string;
}

export interface DerivedScreenActions {
  /** entity name → the actions its screens authorise, in the designer's order. */
  byEntity: Record<string, ScreenAction[]>;
  /** One line per verb that could not be grounded — for the artifact's gaps. */
  refused: string[];
}

/** An entity's attributes as {name, values} — reading both the bare-string and
 *  the object form the ontology allows. */
function attributesOf(ontology: Record<string, unknown>, entity: string): Array<{ name: string; values: string[] }> {
  const row = asRecords(ontology.entities).find((e) => asString(e.name) === entity);
  if (!row) return [];
  return (Array.isArray(row.attributes) ? row.attributes : []).map((a) => {
    if (typeof a === "string") return { name: a, values: [] };
    if (!isRecord(a)) return { name: "", values: [] };
    const vals = Array.isArray(a.values) ? a.values.filter((v): v is string => typeof v === "string" && !!v.trim()) : [];
    return { name: asString(a.name), values: vals };
  }).filter((a) => !!a.name);
}

/**
 * Resolve one authored verb against one entity.
 *
 * Order matters and is deliberate: a state change is the strongest claim (the
 * record visibly moves), then creating the thing the verb names, then the
 * weakest — opening the form where the assignment is made.
 */
function resolveAction(
  label: string,
  entity: string,
  ontology: Record<string, unknown>,
  machineTargets: Map<string, string>,
  entityNames: string[],
  hasScreen: (entity: string) => boolean,
  isPersonAttr: (entity: string, attribute: string) => boolean,
): ScreenAction | "satisfied" | null {
  const attrs = attributesOf(ontology, entity);

  // 1 · `set` — the verb, or the state a machine transition triggered by it
  //     moves to, is a value this entity's own attribute lists.
  const candidates = [asString(machineTargets.get(key(label)) ?? ""), label].filter(Boolean);
  for (const candidate of candidates) {
    for (const attr of attrs) {
      const hit = attr.values.find((v) => key(v) === key(candidate));
      if (hit) {
        return {
          label, kind: "set", attribute: attr.name, value: hit, scope: "record",
          basis: candidate === label
            ? `${attr.name} holds "${hit}"`
            : `the design's state machine moves this to "${hit}", which ${attr.name} holds`,
        };
      }
    }
  }

  // 2 · `create` — the verb names another entity this build gives a screen.
  //     Longest name first, so "Alliance Partner" is not shadowed by "Partner".
  const w = new Set(words(label));
  const named = [...entityNames]
    .filter((n) => n !== entity && hasScreen(n))
    .sort((a, b) => b.length - a.length)
    .find((n) => {
      const nw = words(n);
      return nw.length > 0 && nw.every((part) => w.has(part));
    });
  if (named) {
    return { label, kind: "create", target: named, scope: "list", basis: `opens a new ${named}` };
  }

  // 3 · `assign` — the verb assigns, and there is a person-shaped field to
  //     assign into. The edit form is where that field lives.
  if (/\b(assign|reassign|owner|allocate)\b/i.test(label)) {
    const person = attrs.find((a) => isPersonAttr(entity, a.name));
    if (person) {
      return { label, kind: "assign", attribute: person.name, scope: "record", basis: `edits ${person.name}` };
    }
  }

  // 4 · ALREADY SATISFIED — the verb asks for a capability every screen has.
  //     "Create Campaign" on Campaign is the New button; "Edit Campaign" is
  //     the Edit button. Drawing a second control for it would duplicate the
  //     page, and REFUSING it would be worse: it reports as missing a thing
  //     the build does. Measured on a real design, six of twenty-four refusals
  //     were this — a gap channel that cries wolf is one nobody reads.
  const selfWords = words(entity);
  const namesSelf = selfWords.length > 0 && selfWords.every((part) => w.has(part));
  if (namesSelf && /\b(create|new|add|draft|open|start|identify|register|record)\b/i.test(label)) return "satisfied";
  if (namesSelf && /\b(edit|update|amend|revise|maintain)\b/i.test(label)) return "satisfied";

  return null;
}

/**
 * Every authored verb, resolved. `hasScreen` and `isPersonAttr` are supplied by
 * the assembler because only it knows which entities this build actually drew
 * and how each attribute's role was derived — the same inputs the rest of the
 * assembly is validated against.
 */
export function deriveScreenActions(
  design: unknown,
  ontology: unknown,
  deps: { hasScreen: (entity: string) => boolean; isPersonAttr: (entity: string, attribute: string) => boolean },
): DerivedScreenActions {
  const byEntity: Record<string, ScreenAction[]> = {};
  const refused: string[] = [];
  if (!isRecord(design) || !isRecord(ontology)) return { byEntity, refused };

  // trigger → the state it moves to, across every machine the design carries.
  const machineTargets = new Map<string, string>();
  for (const machine of asRecords(design.workflowMachines)) {
    for (const t of asRecords(machine.transitions)) {
      const on = asString(t.on); const to = asString(t.to);
      if (on && to && !machineTargets.has(key(on))) machineTargets.set(key(on), to);
    }
  }
  const entityNames = asRecords(ontology.entities).map((e) => asString(e.name)).filter(Boolean);

  for (const screen of asRecords(design.screens)) {
    // The screen's PRIMARY entity owns its verbs: the design lists a screen's
    // entities with the one it is about first, and an action authored on a
    // board of leads is an action on a lead.
    const listed = (Array.isArray(screen.entities) ? screen.entities : [])
      .map((e) => asString(e)).filter((e) => entityNames.includes(e));
    const entity = listed[0];
    if (!entity) continue;
    // The wireframe's own action blocks count as authored verbs too — a design
    // may put "Accept Lead" in the header and not repeat it in primaryActions.
    const fromBlocks = asRecords(screen.wireframe)
      .flatMap((r) => asRecords(r.blocks))
      .filter((b) => asString(b.kind) === "action")
      .map((b) => asString(b.label));
    const labels = [...new Set([
      ...(Array.isArray(screen.primaryActions) ? screen.primaryActions : []).map((a) => asString(a)),
      ...fromBlocks,
    ].filter(Boolean))];

    for (const label of labels) {
      const resolved = resolveAction(label, entity, ontology, machineTargets, entityNames, deps.hasScreen, deps.isPersonAttr);
      // A verb the standard controls already answer needs no button and is no
      // gap — the build does it, under the label every screen uses.
      if (resolved === "satisfied") continue;
      if (!resolved) {
        const line = `The design's "${label}" on ${entity} is not drawn: nothing in the model can carry it — no ${entity} field holds that state, no entity of that name has a screen, and it assigns nothing. Either the state is missing from the model or the action means something else; ask in Listen.`;
        if (!refused.includes(line)) refused.push(line);
        continue;
      }
      const list = byEntity[entity] ?? (byEntity[entity] = []);
      if (!list.some((a) => a.label === resolved.label)) list.push(resolved);
    }
  }
  return { byEntity, refused };
}
