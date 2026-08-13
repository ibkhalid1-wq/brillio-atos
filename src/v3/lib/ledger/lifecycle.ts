/**
 * WHICH ENTITIES HAVE A LIFECYCLE, AND WHAT ITS STAGES ARE.
 *
 * An entity with a lifecycle is one the business moves THROUGH states: a Claim is
 * opened, reviewed, settled, closed. That is a different kind of fact from a field's
 * data type, and it is owed by a different person — the people who live the process,
 * in Listen — not by whoever exports a schema. Until now it was asked as neither: the
 * stage attribute's value set arrived in the dictionary bucket as "What values can
 * Opportunity.stage take?", routed to a system owner, alongside "what type is
 * Account.IT spend".
 *
 * DETECTION IS FROM WHAT THE LEDGER ALREADY HOLDS — no new input, nothing asked twice:
 *
 *   NAME     the attribute is called status / stage / state / phase / disposition.
 *            On its own this is a hint, not a finding: "Opportunity.stage" is a
 *            lifecycle, "Account.state" is very likely a postal address.
 *   VALUES   a value set exists for it, stated or asked. Values are what stages ARE.
 *   SPAN     the entity carries a date PAIR (opened/closed, start/end, effective/
 *            expiry). A thing with a beginning and an end has a middle.
 *   MOTION   an Atlas workflow step names the entity with a transition verb
 *            (submit, approve, reject, close, escalate). Somebody moves it.
 *
 * NAME alone is a suggestion. NAME plus any second signal is a finding. This is the
 * same discipline as the derived types: a floor below which Aura proposes and above
 * which it may say so, and never a claim written on one weak reading.
 *
 * WHAT IS WRITTEN: nothing, from here. This module only reads. A confirmed stage list
 * is written the way every other typing answer is written — as a dictionary row
 * through the same merge — so a lifecycle confirmed by a person and one imported from
 * a schema land in the same place under the same precedence.
 */
import type { LedgerStore } from "./store";
import { aboutOf, elementIdOf, isLive } from "./types";

/** Attribute names that MIGHT carry a lifecycle. A hint, never a finding alone. */
const STAGE_NAME = /\b(status|stage|state|phase|disposition|lifecycle|step)\b/i;

/**
 * `state` is the trap: "Account.state" is where somebody lives. Paired with a
 * postal neighbour on the same entity it is an address field, whatever it is called.
 */
const ADDRESS_NEIGHBOUR = /\b(street|city|town|postcode|post code|zip|province|county|country|address)\b/i;

/**
 * Verbs that MOVE something from one state to another.
 *
 * The inflection group is not decoration: an Atlas step is written the way a person
 * says it — "Adjuster approves the Claim", not "approve claim" — and `\bapprove\b`
 * does not match "approves", because the `s` is a word character and the trailing
 * boundary never fires. Written without it, this pattern silently matched almost no
 * real step and the MOTION signal was dead on every programme.
 */
const TRANSITION_VERB = /\b(submit|approve|reject|close|reopen|escalate|assign|cancel|settle|complete|verify|review|publish|archive|activate|suspend)(s|d|es|ed|ing)?\b/i;

/** Date fields that come in pairs. A beginning and an end imply a middle. */
const SPAN_START = /\b(open|opened|start|started|created|effective|received|submitted)\b/i;
const SPAN_END = /\b(close|closed|end|ended|completed|settled|expiry|expires|terminated)\b/i;

export type LifecycleSignal = "name" | "values" | "span" | "motion";

export interface LifecycleEntity {
  entityId: string;
  entity: string;
  /** The attribute that carries the stage. */
  attributeId: string;
  attribute: string;
  /** The `#valueSet` locus — the question a confirmation answers. */
  about: string;
  /** Stages already on the record, in the order the record states them. */
  stages: string[];
  /** Every signal that fired, so the surface can say WHY Aura thinks this. */
  signals: LifecycleSignal[];
  /** True when a second signal backed the name. Below this, it is a suggestion. */
  confident: boolean;
}

const words = (s: string): string => s.toLowerCase();

/** The stated value set for a locus, if the ledger holds one. */
function statedValues(store: LedgerStore, about: string): string[] {
  // `isLive` is the ledger's own definition of "not history" — superseded claims
  // are the record of what was once believed, not what is believed now.
  const live = store.claims().filter((c) => c.about === about && isLive(c));
  for (const claim of live) {
    // A value set arrives as a SCALAR carrying the list ("Open; Closed"), or as a
    // ref-list. Anything else — `unknown`, `na` — is the question still being open,
    // which is not the same as an empty answer and must not read as one.
    const text = claim.value.kind === "scalar" ? String(claim.value.value).trim()
      : claim.value.kind === "ref-list" ? claim.value.to.join("; ")
        : "";
    if (!text) continue;
    const parts = text.split(/[;,|\n]+|\s+·\s+/).map((p) => p.trim()).filter(Boolean);
    if (parts.length >= 2) return parts;
  }
  return [];
}

/**
 * Every entity Aura reads as having a lifecycle, strongest first.
 *
 * Ordering is by how much evidence there is, then by name, so the surface's "first
 * three" are the three worth confirming first rather than three alphabetical ones.
 */
export function lifecycleEntities(store: LedgerStore): LifecycleEntity[] {
  const elements = store.elements();
  const attrsOf = new Map<string, typeof elements>();
  for (const el of elements) {
    if (el.kind !== "attribute" || !el.of) continue;
    const list = attrsOf.get(el.of) ?? [];
    list.push(el);
    attrsOf.set(el.of, list);
  }

  // Atlas steps that name an entity AND a transition verb.
  const movedEntities = new Set<string>();
  for (const el of elements) {
    if (el.kind !== "step" && el.kind !== "workflow") continue;
    const text = words(el.name ?? "");
    if (!TRANSITION_VERB.test(text)) continue;
    for (const entity of elements) {
      if (entity.kind !== "entity") continue;
      if (text.includes(words(entity.name ?? ""))) movedEntities.add(entity.id);
    }
  }

  const out: LifecycleEntity[] = [];
  for (const entity of elements) {
    if (entity.kind !== "entity") continue;
    const attrs = attrsOf.get(entity.id) ?? [];
    const names = attrs.map((a) => words(a.name ?? ""));

    // SPAN — a start-ish field and an end-ish field on the same entity.
    const hasSpan = names.some((n) => SPAN_START.test(n)) && names.some((n) => SPAN_END.test(n));
    const hasMotion = movedEntities.has(entity.id);
    // An entity carrying postal fields makes "state" an address, not a lifecycle.
    const looksPostal = names.some((n) => ADDRESS_NEIGHBOUR.test(n));

    for (const attr of attrs) {
      const name = words(attr.name ?? "");
      if (!STAGE_NAME.test(name)) continue;
      if (looksPostal && /\bstate\b/i.test(name) && !/\b(status|stage|phase)\b/i.test(name)) continue;

      const about = aboutOf(attr.id, "valueSet");
      const stages = statedValues(store, about);
      const signals: LifecycleSignal[] = ["name"];
      if (stages.length) signals.push("values");
      if (hasSpan) signals.push("span");
      if (hasMotion) signals.push("motion");

      out.push({
        entityId: entity.id, entity: entity.name ?? "",
        attributeId: attr.id, attribute: attr.name ?? "",
        about, stages, signals, confident: signals.length >= 2,
      });
    }
  }
  return out.sort((a, b) => b.signals.length - a.signals.length || a.entity.localeCompare(b.entity));
}

/** The `#valueSet` loci that are really lifecycle questions — asked in Listen, of people. */
export function lifecycleLoci(store: LedgerStore): Set<string> {
  return new Set(lifecycleEntities(store).filter((l) => l.confident).map((l) => l.about));
}

/**
 * The EVIDENCE alone, for a row that already names the entity and its attribute in
 * its own column. `lifecycleReason` repeats both — right for a tooltip, redundant
 * beside a cell that just said "Opportunity · stage".
 */
export function lifecycleEvidence(l: LifecycleEntity): string {
  const parts: string[] = [];
  if (l.signals.includes("values")) parts.push(`${l.stages.length} values on the record`);
  if (l.signals.includes("span")) parts.push("has a start and an end date");
  if (l.signals.includes("motion")) parts.push("a workflow step moves it");
  return parts.join(" · ") || "read from the field name alone";
}

/** Why Aura thinks so, for the operator who is entitled to ask. */
export function lifecycleReason(l: LifecycleEntity): string {
  const parts: string[] = [];
  if (l.signals.includes("values")) parts.push(`${l.stages.length} values already on the record`);
  if (l.signals.includes("span")) parts.push("the entity has a start and an end date");
  if (l.signals.includes("motion")) parts.push("a workflow step moves it");
  return parts.length
    ? `“${l.attribute}” reads as a lifecycle — ${parts.join(", ")}.`
    : `“${l.attribute}” reads as a lifecycle from its name alone — worth confirming before it is used as one.`;
}

/** True when a locus is a lifecycle question rather than a plain value-set one. */
export const isLifecycleAbout = (loci: ReadonlySet<string>, about: string): boolean => loci.has(about);

/** The element a lifecycle locus is about — for surfaces that hold only the locus. */
export const lifecycleElementId = (about: string): string => elementIdOf(about);
