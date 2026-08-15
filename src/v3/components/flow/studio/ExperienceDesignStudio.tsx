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
 */
import { useMemo } from "react";
import type { ProgramSummary } from "@/new/types";
import {
  asArray, asRecord, asText, asStrings, useStudioLocked, Section, EmptyState, type StudioProps,
} from "./StudioKit";
import { readArtifactDoc } from "@/v3/components/flow/flowArtifactEdit";

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
  const d = asRecord(doc);
  const chosen = asStrings(d.parentEntities).map((s) => s.trim()).filter(Boolean);
  if (chosen.length) return [...new Set(chosen)];
  const legacy: string[] = [];
  for (const screen of asArray(d.screens).map(asRecord)) {
    for (const e of asStrings(screen.entities)) { const t = e.trim(); if (t && !legacy.includes(t)) legacy.push(t); }
  }
  return legacy;
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

  /** Toggle one entity. Order is menu order, so a re-added entity goes to the end
   *  rather than silently reclaiming its old position. */
  const toggle = (name: string) => {
    if (locked) return;
    const next = chosenSet.has(name) ? chosen.filter((n) => n !== name) : [...chosen, name];
    onChange({ ...doc, parentEntities: next });
  };

  if (!entities.length) {
    return (
      <EmptyState icon="◫" title="No entities yet"
        hint="The Domain Ontology names the entities this decision is about. Generate it in Listen, then come back and choose which of them get a screen." />
    );
  }

  // Suggest, never decide: an entity nothing points AT is a natural top-level record,
  // and one that is only ever a child usually belongs inside its parent's detail.
  const suggested = (e: EntityChoice) => !e.parents.length && e.related.length > 0;

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
                </span>
              </li>
            );
          })}
        </ul>
      </Section>
    </div>
  );
}
