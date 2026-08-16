/**
 * DESIGN OVERRIDES — the decisions a person made about the built application,
 * kept somewhere a rebuild cannot erase.
 *
 * THE PROBLEM THIS EXISTS FOR. `prototypeBuild.html` is a SNAPSHOT. The
 * skeleton is re-derived from the ontology on every generation, so an operator
 * who renames a column in the studio, or a stakeholder who says "we call that
 * Demand gen", has made a decision that survives exactly until the next run —
 * and then vanishes without a word. The programme has been solving this for the
 * evidence documents since the beginning (`flowOperatorOverrides.ts`: "a studio
 * edit merges into the doc, but the doc is REPLACED on regeneration — so the
 * correction itself is captured here"). The prototype was left out of that
 * mechanism. This is its equivalent.
 *
 * AND THE RULE IT ENCODES. A decision that must survive regeneration has to be
 * expressed as DATA, not as pixels. Anything stored as bytes is a photograph of
 * a build, and the next build is a different build.
 *
 * ── ADDRESSED BY WHAT IT IS, NOT BY WHERE IT LANDED ──
 *
 * A fabric id (`field:campaign:campaignstatus`) is DERIVED: entity slug, plus
 * attribute slug, plus a uniquifier that shifts when a sibling appears. Key an
 * override on that and it dies of a rename it has nothing to do with. So an
 * override is addressed by the SOURCE TUPLE — the same `{entity, attribute}` /
 * `{relation}` the fabric node itself carries — and the id is resolved at build
 * time, freshly, every time.
 *
 * That is not a claim that renames are free. If the ontology renames the
 * attribute, the tuple stops matching too. The difference is what happens next:
 * a tuple that half-matches (the entity still exists, or the attribute name
 * survives under a different entity) yields a NAMED, ACTIONABLE orphan with a
 * single suggested re-bind — never a silent loss, and never an automatic guess.
 * Re-binding is a judgement about meaning, so it belongs to a person.
 *
 * ── WHAT MAY BE OVERRIDDEN, AND WHAT MAY NOT ──
 *
 * Presentation only, and deliberately so. A label, a hidden column, the order
 * of columns, the words on an empty state. "Status should be required" is not a
 * presentation decision — it is a claim about the domain, and it belongs in the
 * ontology where the whole chain can see it. Classification happens at capture,
 * by the person who was in the room; `classifyOverride` states the boundary so
 * the surfaces can enforce it rather than each inventing its own version.
 */

/** WHAT the override is attached to — the fabric node's own `source`, restated
 *  as a closed union so a malformed target cannot reach the assembler. */
export type OverrideTarget =
  | { of: "entity"; entity: string }
  | { of: "attribute"; entity: string; attribute: string }
  | { of: "relation"; parent: string; child: string };

/**
 * WHAT is being said about it. Presentation, all of it — see the header.
 *
 * `reset` is the WITHDRAWAL: it clears every decision standing on that address
 * rather than storing an opposite one, so a field hidden and then restored, or
 * renamed and then put back, assembles byte-identically to one nobody ever
 * touched. Writing "visible", or writing the derived name back as a label,
 * would freeze today's ontology into the log — and that name is exactly the
 * thing upstream is allowed to change.
 */
export type OverrideKind = "label" | "hide" | "reset" | "emptyText";

/**
 * WHO said it, which is not decoration: the ledger's own precedence turns on
 * it. A stakeholder's `asserted` decision outranks the operator's, and both
 * outrank anything a generation proposed — the same ordering `precedence.ts`
 * applies to claims, applied here so the two cannot disagree about who wins.
 */
export type OverrideVia = "asserted" | "operator";

export interface DesignOverride {
  /** Stable per entry, so a projection can be diffed and an entry withdrawn. */
  id: string;
  at: string;
  by: string;
  byRole?: string;
  via: OverrideVia;
  kind: OverrideKind;
  target: OverrideTarget;
  /** The label, or the empty-state copy. Ignored by `hide` / `reset`. */
  value?: string;
  /** What was actually said, when the override came out of a review. */
  note?: string;
}

const text = (v: unknown): string => String(v ?? "").trim();
const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

const KINDS = new Set<OverrideKind>(["label", "hide", "reset", "emptyText"]);
const VIAS = new Set<OverrideVia>(["asserted", "operator"]);

/**
 * The address as a comparable string — one definition, so the projection, the
 * resolver and the tests cannot disagree about what "the same locus" means.
 *
 * Joined on an ESCAPED NUL, for both halves of that phrase. The BYTE is the
 * right separator: no entity or attribute name can contain it, so
 * `attribute "a b" · "c"` cannot collide with `attribute "a" · "b c"` the way a
 * space would. And writing it ESCAPED is not a style preference — a raw one
 * makes this file BINARY to grep and ripgrep, which then skip it in silence, so
 * a reader searching for any symbol in it gets no hits and reasonably concludes
 * the code is not here. That cost two searches in one session the last time it
 * happened, in `prototypeRefine.ts`. Same value, same comparison, ASCII source.
 */
export function targetKey(t: OverrideTarget): string {
  if (t.of === "entity") return `entity\u0000${t.entity.toLowerCase()}`;
  if (t.of === "attribute") return `attribute\u0000${t.entity.toLowerCase()}\u0000${t.attribute.toLowerCase()}`;
  return `relation\u0000${t.parent.toLowerCase()}\u0000${t.child.toLowerCase()}`;
}

/** Human phrasing of an address, for a gap line somebody has to act on. */
export function targetLabel(t: OverrideTarget): string {
  if (t.of === "entity") return t.entity;
  if (t.of === "attribute") return `${t.entity}.${t.attribute}`;
  return `${t.parent} → ${t.child}`;
}

function readTarget(v: unknown): OverrideTarget | null {
  if (!isRecord(v)) return null;
  const of = text(v.of);
  if (of === "entity") {
    const entity = text(v.entity);
    return entity ? { of: "entity", entity } : null;
  }
  if (of === "attribute") {
    const entity = text(v.entity), attribute = text(v.attribute);
    return entity && attribute ? { of: "attribute", entity, attribute } : null;
  }
  if (of === "relation") {
    const parent = text(v.parent), child = text(v.child);
    return parent && child ? { of: "relation", parent, child } : null;
  }
  return null;
}

/**
 * READ the stored log. Deliberately forgiving of rows it does not understand
 * and unforgiving about the parts it acts on: an entry with no target, no kind
 * or no author is not an override, it is a fragment, and applying a fragment to
 * a client-facing build is worse than dropping it.
 */
export function readDesignOverrides(stored: unknown): DesignOverride[] {
  const rows = Array.isArray(stored) ? stored : [];
  const out: DesignOverride[] = [];
  for (const row of rows) {
    if (!isRecord(row)) continue;
    const target = readTarget(row.target);
    const kind = text(row.kind) as OverrideKind;
    const via = text(row.via) as OverrideVia;
    const by = text(row.by);
    if (!target || !KINDS.has(kind) || !by) continue;
    if ((kind === "label" || kind === "emptyText") && !text(row.value)) continue;
    out.push({
      id: text(row.id) || `${targetKey(target)}\u0000${kind}\u0000${text(row.at)}`,
      at: text(row.at),
      by,
      byRole: text(row.byRole) || undefined,
      via: VIAS.has(via) ? via : "operator",
      kind,
      target,
      value: text(row.value) || undefined,
      note: text(row.note) || undefined,
    });
  }
  return out;
}

/**
 * THE LOG, PROJECTED TO WHAT HOLDS NOW.
 *
 * Append-only is right for the record and wrong for the assembler: a build
 * needs one answer per address, not a history. Later entries win over earlier
 * ones, and an `asserted` entry wins over an `operator` one WHATEVER their
 * order — a stakeholder's decision is not overturned by an operator editing
 * afterwards, which is the same precedence the claims ledger applies and the
 * reason both are stated in one place.
 *
 * A `reset` is not an override — it is the WITHDRAWAL of every decision on that
 * address, resolving them to nothing rather than storing an opposite.
 */
export function projectOverrides(entries: readonly DesignOverride[]): Map<string, DesignOverride> {
  const byAddress = new Map<string, DesignOverride>();
  for (const e of entries) {
    const address = targetKey(e.target);
    if (e.kind === "reset") {
      // A withdrawal clears the address — EXCEPT where a stakeholder's own
      // decision stands there. An operator does not overturn an assertion by
      // clicking ×: that is an adjudication, and it belongs in the deviation
      // register where both sides are visible.
      for (const [key, held] of [...byAddress]) {
        if (!key.startsWith(`${address}\u0000`)) continue;
        if (held.via === "asserted" && e.via !== "asserted") continue;
        byAddress.delete(key);
      }
      continue;
    }
    const key = `${address}\u0000${e.kind}`;
    const held = byAddress.get(key);
    if (held && held.via === "asserted" && e.via !== "asserted") continue;
    byAddress.set(key, e);
  }
  return byAddress;
}

/** What the ontology holds, as the resolver needs to see it. */
export interface OverrideWorld {
  /** Entity name → its attribute names, both as the ontology spells them. */
  entities: Map<string, string[]>;
  /** Every parent→child pair the ontology declares. */
  relations: Array<[string, string]>;
}

export function worldOf(ontology: unknown): OverrideWorld {
  const doc = isRecord(ontology) ? ontology : {};
  const entities = new Map<string, string[]>();
  for (const e of Array.isArray(doc.entities) ? doc.entities : []) {
    if (!isRecord(e)) continue;
    const name = text(e.name);
    if (!name) continue;
    const attrs = (Array.isArray(e.attributes) ? e.attributes : [])
      .map((a) => (typeof a === "string" ? a : isRecord(a) ? text(a.name) : ""))
      .filter(Boolean);
    entities.set(name, attrs);
  }
  const relations: Array<[string, string]> = [];
  for (const r of Array.isArray(doc.relations) ? doc.relations : []) {
    if (!isRecord(r)) continue;
    const from = text(r.from), to = text(r.to);
    if (from && to) relations.push([from, to]);
  }
  return { entities, relations };
}

const eqi = (a: string, b: string) => a.toLowerCase() === b.toLowerCase();

/** An override the build could not honour, and the one thing to do about it. */
export interface OrphanedOverride {
  override: DesignOverride;
  /** The single unambiguous candidate, when the world holds exactly one. */
  suggestion?: OverrideTarget;
  reason: string;
}

export interface ResolvedOverrides {
  /** Address → the entry in force, for every override this world can honour. */
  applied: Map<string, DesignOverride>;
  orphaned: OrphanedOverride[];
}

/**
 * RESOLVE the projection against the ontology this build is being made from.
 *
 * An exact tuple match applies. Anything else is an orphan — reported with a
 * suggestion when the world holds exactly ONE plausible re-bind (the attribute
 * name survives under a single other entity, or the entity survives and holds a
 * single attribute of that name). Two candidates is not a suggestion, it is a
 * question, and this function does not answer questions.
 *
 * NOTHING IS RE-BOUND AUTOMATICALLY. A silent re-bind would move a
 * stakeholder's decision onto a field they never saw.
 */
export function resolveOverrides(
  entries: readonly DesignOverride[],
  world: OverrideWorld,
): ResolvedOverrides {
  const applied = new Map<string, DesignOverride>();
  const orphaned: OrphanedOverride[] = [];
  const entityNames = [...world.entities.keys()];

  for (const [key, e] of projectOverrides(entries)) {
    const t = e.target;
    if (t.of === "entity") {
      if (entityNames.some((n) => eqi(n, t.entity))) { applied.set(key, e); continue; }
      orphaned.push({ override: e, reason: `no entity named "${t.entity}"` });
      continue;
    }
    if (t.of === "attribute") {
      const owner = entityNames.find((n) => eqi(n, t.entity));
      const attrs = owner ? world.entities.get(owner)! : [];
      if (owner && attrs.some((a) => eqi(a, t.attribute))) { applied.set(key, e); continue; }
      // The entity is there and the attribute is not — or the reverse. Either
      // way, say which, because they are different problems for the reader.
      const elsewhere = entityNames.filter((n) => (world.entities.get(n) ?? []).some((a) => eqi(a, t.attribute)));
      orphaned.push({
        override: e,
        ...(elsewhere.length === 1 ? { suggestion: { of: "attribute", entity: elsewhere[0], attribute: t.attribute } as OverrideTarget } : {}),
        reason: owner
          ? `"${t.entity}" no longer has an attribute named "${t.attribute}"`
          : `no entity named "${t.entity}"`,
      });
      continue;
    }
    if (world.relations.some(([p, c]) => eqi(p, t.parent) && eqi(c, t.child))) { applied.set(key, e); continue; }
    orphaned.push({ override: e, reason: `no relation from "${t.parent}" to "${t.child}"` });
  }
  return { applied, orphaned };
}

/** Look one up, by the address the assembler is standing on. */
export function overrideFor(
  applied: Map<string, DesignOverride>,
  target: OverrideTarget,
  kind: OverrideKind,
): DesignOverride | undefined {
  return applied.get(`${targetKey(target)}\u0000${kind}`);
}

/** Whether this address is hidden by somebody's decision. */
export function isHidden(applied: Map<string, DesignOverride>, target: OverrideTarget): boolean {
  return !!overrideFor(applied, target, "hide");
}

/** The label in force, or the build's own. */
export function labelFor(
  applied: Map<string, DesignOverride>,
  target: OverrideTarget,
  derived: string,
): string {
  return overrideFor(applied, target, "label")?.value || derived;
}

/**
 * WHAT AN ORPHAN COSTS, said out loud.
 *
 * The rule the approved skin already follows: a decision that cannot be applied
 * is NAMED, never dropped. These lines go into the artifact's own gaps, so the
 * loss reaches the person who can fix it instead of being discovered at a demo.
 */
export function orphanGaps(orphans: readonly OrphanedOverride[]): string[] {
  return orphans.map((o) => {
    const what = o.override.kind === "hide" ? "hidden"
      : o.override.kind === "emptyText" ? `empty-state copy "${o.override.value}"`
      : `renamed to "${o.override.value}"`;
    const who = o.override.byRole ? `${o.override.by} (${o.override.byRole})` : o.override.by;
    const fix = o.suggestion ? ` Re-point it at ${targetLabel(o.suggestion)}, or withdraw it.` : "";
    return `Design decision not applied — ${who} had ${targetLabel(o.override.target)} ${what}, but ${o.reason}.${fix}`;
  });
}

/**
 * PRESENTATION OR SPINE — the classification that has to happen at capture.
 *
 * A person pointing at a screen says two different kinds of thing, and only one
 * of them belongs here. "Call it Demand gen" is presentation: it changes what
 * the build shows and nothing about what is true. "A campaign cannot be
 * cancelled after it closes" is a claim about the domain — routing it into an
 * override would put a rule in the pixels where the ontology, the questions and
 * every downstream document cannot see it.
 *
 * Returned as a recommendation for a surface to ACT on, never as a silent
 * decision: the person who was in the room confirms it, because they know which
 * one they meant.
 */
export function classifyOverride(said: string): "presentation" | "spine" {
  const s = said.toLowerCase();
  // Rules, constraints, obligations and lifecycle statements are the spine's.
  // Deliberately narrow: a phrase this misses is offered as presentation and
  // the operator moves it, which is a smaller error than silently filing a
  // business rule as a label change.
  const SPINE = [
    /\b(must|cannot|can't|should not|shouldn't|never|always)\b/,
    /\b(required|mandatory|optional)\b/,
    /\b(before|after|once)\b.*\b(closed?|approved?|submitted?|cancelled?)\b/,
    /\bonly\b.*\b(can|may)\b/,
    /\b(owns?|belongs to|reports to|approves?)\b/,
  ];
  return SPINE.some((re) => re.test(s)) ? "spine" : "presentation";
}

/**
 * WHERE THE PROGRAMME KEEPS THEM.
 *
 * `phaseInputs.envision._designOverrides`, underscore-prefixed like every other
 * overlay: the prefix keeps it out of the movement fingerprint, so renaming a
 * column does not flag every downstream document stale. It rides the same
 * `onSaveInputs` write path the gap routes and role bindings use — a new
 * persistence channel for this would have been a second way to do a thing the
 * app already does one way.
 *
 * A root-level `designOverrides` array is also read, for a caller assembling
 * from a bare record rather than from a live programme.
 */
export function storedOverridesOf(inner: Record<string, unknown>): unknown[] {
  const out: unknown[] = [];
  const phases = isRecord(inner.phaseInputs) ? inner.phaseInputs : {};
  const envision = isRecord(phases.envision) ? phases.envision : {};
  const raw = envision._designOverrides;
  const parsed = typeof raw === "string"
    ? (() => { try { return JSON.parse(raw); } catch { return null; } })()
    : raw;
  if (Array.isArray(parsed)) out.push(...parsed);
  if (Array.isArray(inner.designOverrides)) out.push(...inner.designOverrides);
  return out;
}

/**
 * A FABRIC NODE AS AN ADDRESS SOMEBODY CAN POINT AT.
 *
 * The running build tags every element with its fabric id, so a click in the
 * preview already names a node — and the node carries the `source` tuple this
 * module addresses by. That is the whole reason direct manipulation is possible
 * at all: pointing at something IS naming it, with no prose in between and
 * nothing to parse back.
 */
export function targetOfFabricNode(node: {
  kind?: unknown; source?: unknown;
}): OverrideTarget | null {
  const src = isRecord(node.source) ? node.source : null;
  if (!src) return null;
  const entity = text(src.entity), attribute = text(src.attribute);
  if (entity && attribute) return { of: "attribute", entity, attribute };
  if (entity) return { of: "entity", entity };
  const rel = Array.isArray(src.relation) ? src.relation.map(text) : [];
  if (rel.length === 2 && rel[0] && rel[1]) return { of: "relation", parent: rel[0], child: rel[1] };
  return null;
}
