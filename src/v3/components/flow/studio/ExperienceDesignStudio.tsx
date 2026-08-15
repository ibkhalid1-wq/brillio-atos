/**
 * Experience Design — WHICH ENTITIES GET A SCREEN.
 *
 * This was a screen designer: a palette, a device canvas, drag-to-reorder blocks per
 * region, per-screen state copy, wireframes stored on the document. It let a delivery
 * team draw a screen by hand — and drawing a screen by hand is not the decision this
 * movement exists to take. The prototype already assembles a list, a detail and the
 * related collections for any entity from the ontology and the fabric; what it could
 * not know is which entities deserve to be in the NAVIGATION at all.
 *
 * So the surface is now the decision, and only the decision: every entity the ontology
 * holds, and one toggle — does this get a parent screen? The prototype turns each one
 * ON into a menu item, its list, its detail, and the related entities that hang off it.
 *
 * `parentEntities` (a string[] of entity names) is the whole output. The old `screens`
 * array is NOT deleted from the document — a programme that has one keeps it, it is
 * simply no longer authored here, and `experienceParentEntities` falls back to it so a
 * document authored the old way still names its navigation.
 *
 * ── AND WHAT EACH OF THOSE SCREENS LEADS WITH ────────────────────────────────
 *
 * The menu was the first decision the assembler could not take for itself. Three more
 * sit immediately behind it, and the assembler was deciding all three alone: which
 * columns head an entity's list, which of its related collections stand open on the
 * detail, and — where the entity declares a status — whether the list opens on the
 * board rather than the table. `screenOptions` (a per-entity record) is the whole of
 * that answer, read through the same one definition the assembler spends it by.
 *
 * The surface offers ONLY what this ontology can honour: the columns are its own
 * attributes, the collections are the child regions the fabric actually declares, and
 * the board is offered only where a status attribute exists — because the assembler
 * ignores a board asked for without one, and a control that is ignored is a lie. Where
 * a choice runs past the page's budget the surface SAYS SO, naming what will not
 * appear, rather than being quietly truncated on the way to the build.
 */
import { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import {
  asArray, asRecord, asText, useStudioLocked, Section, EmptyState, type StudioProps,
} from "./StudioKit";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";
import {
  parentEntitiesFor, screenOptionsFor, screenFactsFor, openSectionPlan, humanizeField,
  SCREEN_BUDGET, type EntityScreenOptions, type EntityScreenFacts,
} from "@shared/prototypeAssembly.ts";

/** One entity as this surface needs it: what it is, and what hangs off it. */
export interface EntityChoice {
  name: string;
  area: string;
  definition: string;
  attributes: number;
  /** Entities reachable from this one — what a detail screen can show as related. */
  related: string[];
  /** Entities that reach THIS one. A child of something is rarely a parent screen. */
  parents: string[];
}

/**
 * THE ONE DEFINITION of "which entities are parent screens", read by this studio and
 * by the prototype assembly so a toggle here and a menu item there cannot disagree.
 *
 * Order matters — it is the menu order — so this preserves the stored order and only
 * falls back when nothing has been chosen. The fallback reads the legacy `screens`
 * array's entities, so a document authored in the old designer still has navigation.
 */
export function experienceParentEntities(doc: Record<string, unknown> | null | undefined): string[] {
  // Delegated, not duplicated. The edge assembles the same prototype (the
  // stakeholder's link, and the baseline the refine agent restyles) and cannot
  // import from `src/v3`, so the reading lives in the shared assembly module and
  // both runtimes call it. A second copy here is how the studio's menu and the
  // built application would quietly stop agreeing.
  return parentEntitiesFor(doc);
}

/**
 * THE ONE DEFINITION of the per-entity screen options, delegated for the same
 * reason `experienceParentEntities` is: the edge assembles the same prototype and
 * cannot import from `src/v3`, so the reading lives in the shared assembly module and
 * every runtime calls it. A second copy here is how a toggle on this surface and the
 * built application quietly stop agreeing.
 */
export function experienceScreenOptions(
  doc: Record<string, unknown> | null | undefined,
): Record<string, EntityScreenOptions> {
  return screenOptionsFor(doc);
}

/**
 * WHAT THIS ONTOLOGY CAN HONOUR, per entity — derived from the same fabric and the
 * same roles the assembler builds from, so this surface cannot offer a column, a
 * collection or a board the build will ignore.
 */
export function readScreenFacts(program: ProgramSummary | null | undefined): Map<string, EntityScreenFacts> {
  const ontology = program ? readArtifactDoc(program, "domainOntology") : null;
  const atlas = program ? readArtifactDoc(program, "currentStateAtlas") : null;
  return new Map(screenFactsFor(ontology ?? {}, atlas ?? {}).map((f) => [f.entity, f] as const));
}

/** Every entity the ontology holds, with its relations resolved both ways. */
export function readEntityChoices(program: ProgramSummary | null | undefined): EntityChoice[] {
  const od = program ? readArtifactDoc(program, "domainOntology") : null;
  const entities = asArray(od?.entities).map(asRecord)
    .map((e) => ({
      name: asText(e.name).trim(),
      area: asText(e.area).trim(),
      definition: asText(e.definition).trim(),
      attributes: asArray(e.attributes).length,
    }))
    .filter((e) => e.name);
  const known = new Set(entities.map((e) => e.name));
  const related = new Map<string, Set<string>>();
  const parents = new Map<string, Set<string>>();
  for (const r of asArray(od?.relations).map(asRecord)) {
    const from = asText(r.from).trim(), to = asText(r.to).trim();
    if (!known.has(from) || !known.has(to) || from === to) continue;
    (related.get(from) ?? related.set(from, new Set()).get(from)!).add(to);
    (parents.get(to) ?? parents.set(to, new Set()).get(to)!).add(from);
  }
  return entities.map((e) => ({
    ...e,
    related: [...(related.get(e.name) ?? [])].sort(),
    parents: [...(parents.get(e.name) ?? [])].sort(),
  }));
}

export default function ExperienceDesignStudio({ doc, onChange, program }: StudioProps) {
  const locked = useStudioLocked();
  const entities = useMemo(() => readEntityChoices(program), [program]);
  const chosen = useMemo(() => experienceParentEntities(doc), [doc]);
  const chosenSet = useMemo(() => new Set(chosen), [chosen]);
  const facts = useMemo(() => readScreenFacts(program), [program]);
  const options = useMemo(() => experienceScreenOptions(doc), [doc]);

  /** Toggle one entity. Order is menu order, so a re-added entity goes to the end
   *  rather than silently reclaiming its old position. */
  const toggle = (name: string) => {
    if (locked) return;
    const next = chosenSet.has(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
    onChange({ ...doc, parentEntities: next });
  };

  /**
   * WRITE ONE ENTITY'S OPTIONS — and write NOTHING where the answer is the derived
   * one. An emptied list and an explicit "table" are both the default, so they are
   * stored as absence: a document that recorded the default would assemble the same
   * bytes and diff as though a decision had been taken.
   */
  const setOption = (name: string, patch: Partial<EntityScreenOptions>) => {
    if (locked) return;
    const next: EntityScreenOptions = { ...(options[name] ?? {}), ...patch };
    if (!next.columns?.length) delete next.columns;
    if (!next.collections?.length) delete next.collections;
    if (next.view !== "board") delete next.view;
    const all: Record<string, EntityScreenOptions> = { ...options };
    if (Object.keys(next).length) all[name] = next; else delete all[name];
    onChange({ ...doc, screenOptions: all });
  };
  /** Click order is the order the build reads, so a re-added name goes to the end. */
  const toggleIn = (list: readonly string[], value: string): string[] =>
    list.includes(value) ? list.filter((x) => x !== value) : [...list, value];

  if (!entities.length) {
    return (
      <EmptyState icon="◫" title="No entities yet"
        hint="The Domain Ontology names the entities this decision is about. Generate it in Listen, then come back and choose which of them get a screen." />
    );
  }

  // Suggest, never decide: an entity nothing points AT is a natural top-level record,
  // and one that is only ever a child usually belongs inside its parent's detail.
  const suggested = (e: EntityChoice) => !e.parents.length && e.related.length > 0;

  /** The entities that will appear INSIDE this one's detail: the ones it owns which
   *  do not have a screen of their own. Recomputed per render off `chosenSet`, so
   *  toggling a child moves it out of its parent's list in the same click. */
  const byName = new Map(entities.map((x) => [x.name, x] as const));
  const childrenOf = (e: EntityChoice): string[] =>
    entities.filter((x) => x.parents.includes(e.name) && !chosenSet.has(x.name)).map((x) => x.name)
      .concat(e.related.filter((r) => !chosenSet.has(r) && !byName.get(r)?.parents.includes(e.name)))
      .filter((n, i, a) => a.indexOf(n) === i).sort();

  /**
   * WHICH ENTITIES ACTUALLY GET A SCREEN in the build these options would land in —
   * the same fallback the assembler applies (`navigationFor`): the operator's choice
   * when they have made one, every entity when they have not. Offering screen options
   * for an entity that has no screen would be offering work the build cannot spend.
   */
  const willHaveScreen = (name: string) => (chosen.length ? chosenSet.has(name) : true);

  /** An attribute as the built table heads it — `humanizeField` is the assembler's
   *  own labelling, so the chip and the column head read the same. `_display` is not
   *  an attribute: it is the record's own name, headed with the entity. */
  const columnLabel = (entity: string, column: string) =>
    (column === "_display" ? entity : humanizeField(column));

  /**
   * ONE ENTITY'S SCREEN OPTIONS. Every control here is derived from what the ontology
   * holds, and every one states what the build will do with it — including where a
   * choice runs past the page's budget, which is the one place this surface could
   * otherwise promise something the assembler quietly drops.
   */
  const optionsPanel = (e: EntityChoice) => {
    const f = facts.get(e.name);
    if (!f) return null;
    const o = options[e.name] ?? {};
    // Only names the ontology still holds count — a stale one is not a column.
    const cols = (o.columns ?? []).filter((c) => f.attributes.includes(c));
    const colsShown = cols.slice(0, SCREEN_BUDGET.listColumns);
    const colsOver = cols.slice(SCREEN_BUDGET.listColumns);
    const namedCollections = (o.collections ?? []).filter((c) => f.collections.includes(c));
    const plan = openSectionPlan(f.collections, namedCollections);
    const authoredCount = colsShown.length + namedCollections.length + (o.view === "board" ? 1 : 0);
    return (
      <details className="v3ed-opts">
        <summary className="v3ed-opts-s">
          Screen options
          <span className="v3ed-opts-n">{authoredCount ? `${authoredCount} chosen` : "all derived"}</span>
        </summary>

        <div className="v3ed-opt">
          <span className="v3ed-opt-k">Columns that lead the list</span>
          {f.attributes.length ? (
            <div className="v3ed-chips">
              {f.attributes.map((a) => {
                const pos = cols.indexOf(a);
                return (
                  <button key={a} type="button" disabled={locked} aria-pressed={pos >= 0}
                    className={`v3ed-chip${pos >= 0 ? " is-on" : ""}`}
                    onClick={() => setOption(e.name, { columns: toggleIn(cols, a) })}>
                    {columnLabel(e.name, a)}
                    {pos >= 0 ? <span className="v3ed-chip-n">#{pos + 1}</span> : null}
                  </button>
                );
              })}
            </div>
          ) : <span className="v3ed-note">{e.name} holds no attributes yet, so its list leads with the record itself.</span>}
          <span className="v3ed-note">
            {cols.length
              ? `Leads with ${colsShown.map((c) => columnLabel(e.name, c)).join(", ")} — here and wherever ${e.name} appears as a related list (the first ${SCREEN_BUDGET.relatedColumns} of them there).`
              : `Derived: ${f.columns.map((c) => columnLabel(e.name, c)).join(", ")}. Choose to override.`}
            {colsOver.length
              ? ` Past the ${SCREEN_BUDGET.listColumns}-column budget, so ${colsOver.map((c) => columnLabel(e.name, c)).join(", ")} will not appear.`
              : ""}
          </span>
        </div>

        {f.collections.length ? (
          <div className="v3ed-opt">
            <span className="v3ed-opt-k">Related collections that lead the detail</span>
            <div className="v3ed-chips">
              {f.collections.map((c) => {
                const pos = namedCollections.indexOf(c);
                return (
                  <button key={c} type="button" disabled={locked} aria-pressed={pos >= 0}
                    className={`v3ed-chip${pos >= 0 ? " is-on" : ""}`}
                    onClick={() => setOption(e.name, { collections: toggleIn(namedCollections, c) })}>
                    {c}
                    {pos >= 0 ? <span className="v3ed-chip-n">#{pos + 1}</span> : null}
                  </button>
                );
              })}
            </div>
            {/* NOTHING IS EVER DROPPED — the tail collapses, and the surface says so
                by name, so an operator can see that the section they did not name is
                still on the page rather than gone from it. */}
            <span className="v3ed-note">
              {`Stands open: ${plan.open.join(", ")}.`}
              {plan.collapsed.length
                ? ` The other ${plan.collapsed.length} ${plan.collapsed.length === 1 ? "collapses" : "collapse"} behind “+${plan.collapsed.length} more related”: ${plan.collapsed.join(", ")}.`
                : ""}
            </span>
          </div>
        ) : null}

        <div className="v3ed-opt">
          <span className="v3ed-opt-k">The list opens on</span>
          {/* A BOARD NEEDS A STATUS TO LANE BY. The assembler offers no board without
              one, so neither does this — the alternative is a switch that writes a
              choice the build has to ignore. */}
          {f.status ? (<>
            <div className="v3ed-chips" role="group" aria-label={`Opening view for ${e.name}`}>
              {(["table", "board"] as const).map((v) => (
                <button key={v} type="button" disabled={locked} aria-pressed={(o.view ?? "table") === v}
                  className={`v3ed-chip${(o.view ?? "table") === v ? " is-on" : ""}`}
                  onClick={() => setOption(e.name, { view: v })}>
                  {v === "table" ? "Table" : "Board"}
                </button>
              ))}
            </div>
            <span className="v3ed-note">Laned by {humanizeField(f.status)} — the attribute this ontology holds as {e.name}&rsquo;s status.</span>
          </>) : (
            <span className="v3ed-note">Table. {e.name} declares no status attribute, so there are no lanes to build a board from.</span>
          )}
        </div>
      </details>
    );
  };

  return (
    <div className="v3ed">
      <Section label="Parent screens"
        hint="Each one ON becomes a menu item in the prototype: its own list, a detail page for one record, and the related entities that hang off it.">
        <p className="v3ed-lead">
          <b>{chosen.length}</b> of {entities.length} {entities.length === 1 ? "entity" : "entities"} will
          get a screen. Everything else still exists in the model — it simply appears inside the detail
          of whatever owns it, rather than in the navigation.
        </p>
        <ul className="v3ed-list">
          {entities.map((e) => {
            const on = chosenSet.has(e.name);
            const order = on ? chosen.indexOf(e.name) + 1 : 0;
            return (
              <li key={e.name} className={`v3ed-row${on ? " is-on" : ""}`}>
                <button type="button" role="switch" aria-checked={on} disabled={locked}
                  className="v3ed-toggle" onClick={() => toggle(e.name)}
                  aria-label={`${on ? "Remove" : "Add"} a parent screen for ${e.name}`}>
                  <span className="v3ed-knob" aria-hidden="true" />
                </button>
                <span className="v3ed-body">
                  <span className="v3ed-h">
                    <b className="v3ed-name">{e.name}</b>
                    {on ? <span className="v3ed-pos" aria-label={`menu position ${order}`}>#{order} in the menu</span> : null}
                    {!on && suggested(e) ? <span className="v3ed-sug">nothing owns it — usually a top-level record</span> : null}
                    {e.area ? <span className="v3ed-area">{e.area}</span> : null}
                  </span>
                  {e.definition ? <span className="v3ed-def">{e.definition}</span> : null}
                  <span className="v3ed-meta">
                    {e.attributes} field{e.attributes === 1 ? "" : "s"}
                    {e.related.length ? <> · shows <b>{e.related.length}</b> related: {e.related.slice(0, 4).join(", ")}{e.related.length > 4 ? ` +${e.related.length - 4}` : ""}</> : <> · no related entities</>}
                    {e.parents.length ? <> · sits under {e.parents.slice(0, 3).join(", ")}</> : null}
                  </span>
                  {/* WHAT ACTUALLY LANDS INSIDE THIS SCREEN. `related` is everything
                      this entity points at; the ones that get their OWN menu item are
                      not inside it, they are beside it. So the list an operator needs
                      is the children that are NOT parent screens — those are the ones
                      that appear in this detail page and nowhere else. Toggling a
                      child ON moves it out of this list and into the menu, which is
                      the trade the whole surface exists to make visible. */}
                  {on && childrenOf(e).length ? (
                    <span className="v3ed-children">
                      <span className="v3ed-children-k">inside it</span>
                      {childrenOf(e).join(" · ")}
                    </span>
                  ) : on ? (
                    <span className="v3ed-children"><span className="v3ed-children-k">inside it</span>nothing — every entity it owns has its own screen</span>
                  ) : null}
                  {/* WHAT THAT SCREEN LEADS WITH. Offered for every entity the build
                      will actually give a screen to — the operator's chosen ones, or
                      all of them while nothing is chosen, which is the same fallback
                      the assembler applies. */}
                  {willHaveScreen(e.name) ? optionsPanel(e) : null}
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
