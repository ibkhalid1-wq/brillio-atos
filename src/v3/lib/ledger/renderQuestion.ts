/**
 * THE one question renderer. A question is NOT stored text — it is
 * (locus, kind, owner, status) in the ledger, and this module is the only place
 * question text comes from. Every surface (stakeholder linked page, kit, roster
 * chip, operator queue, burn-down drill) projects the same set through here, so
 * the surfaces cannot phrase-drift and counts cannot diverge.
 *
 * Rules (deterministic, no model key):
 *  · FULL data at render time — a step's complete action text comes from its
 *    `#action` claim (the element name is a 60-char migration cut, never shown);
 *    entity/attribute names keep their ORIGINAL casing (no mid-template patching).
 *  · NO truncation in the string, ever. Ellipsis is a display-layer concern
 *    (CSS + full text on hover) — a rendered question is always whole.
 *  · Steps are QUOTED verbatim, then asked about — quoting sidesteps every
 *    conjugation bug: `One step in your process is: "<action>." Should this…`
 *  · Relations render as plain language, never arrow notation.
 *  · audience="stakeholder" → second person, plain; audience="operator" → same
 *    deterministic text in third person (ids/type tags are projection metadata,
 *    not text).
 *  · LLM-polished phrasing is a later, gated layer ON TOP — it may rephrase,
 *    never change locus or kind, and falls back to these templates.
 */
import type { LedgerStore } from "./store";
import type { LedgerElement } from "./types";
import { elementIdOf, slotOf, isLive } from "./types";
import { READING_SLOT_PREFIX } from "./migrate";
import { lifecycleLoci } from "./lifecycle";

export type Audience = "stakeholder" | "operator";

/** Kind-specific answer affordance — a chip answer is a one-tap attributed assertion. */
export type AnswerAffordance =
  | { kind: "chips"; options: readonly string[]; whyOptional: true }
  | { kind: "phase-picker" }
  | { kind: "role-picker"; freeText: true }
  | { kind: "free-text"; whyOptional: boolean };

export interface RenderedQuestion {
  /** The locus this question closes — always resolves to an open ledger claim. */
  id: string;
  elementId: string;
  /** The element's FULL display name (a step's complete action) — never truncated. */
  elementName: string;
  /** The unknown kind (the slot). */
  kind: string;
  /** Plain type label: "Automate this?" / "Which phase" / "What this means"… */
  label: string;
  /** The full question text — never truncated, never stored. */
  question: string;
  /**
   * THE SAME QUESTION WITH ITS SUBJECT LEFT OUT, for a surface that has already
   * named the subject — a grouped card whose header IS the step.
   *
   * The operator inbox fixed this by grouping ("a question list states its
   * subject once"); the stakeholder's page grouped too but still rendered the
   * full text in every row, so a step with three unknowns restated the whole
   * step three times inside a card already headed with it — the same forty
   * words, three times, differing in the last six.
   *
   * Equal to `question` wherever the phrasing carries no separable stem, so a
   * surface can render `short` unconditionally inside a group and lose nothing.
   */
  short: string;
  affordance: AnswerAffordance;
}

const LABELS: Record<string, string> = {
  automationDisposition: "Automate this?",
  phase: "When it happens",
  actorRole: "Who does this",
  decision: "What decides",
  semantics: "What this means",
  dataType: "What type",
  valueSet: "Which values",
  optionality: "Required?",
  cardinality: "How many",
  trigger: "What starts it",
  owner: "Who owns this",
  systemOfRecord: "System of record",
  exists: "Still exists?",
  area: "Which area",
  handoffRule: "The handoff",
  isClientOrPartner: "Client or partner",
};

export const questionLabel = (kind: string): string =>
  LABELS[kind] ?? kind.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase()).trim();

const affordanceFor = (kind: string): AnswerAffordance =>
  kind === "automationDisposition" ? { kind: "chips", options: ["Automate", "Assist", "Keep manual"], whyOptional: true }
    : kind === "phase" ? { kind: "phase-picker" }
      : kind === "actorRole" || kind === "owner" ? { kind: "role-picker", freeText: true }
        : { kind: "free-text", whyOptional: kind === "semantics" || kind === "decision" };

/** Resolve the live scalar value at a locus (e.g. a step's full `action` text). */
function scalarAt(store: LedgerStore, about: string): string | null {
  const live = store.resolve(about).live.find((c) => isLive(c) && c.value.kind === "scalar");
  return live ? String((live.value as { value: unknown }).value) : null;
}

/**
 * The COMPETING READINGS the ledger holds for an element's meaning — the
 * `semantics.reading.*` claims a migrated terminology collision leaves beside the
 * `#semantics` unknown. Live scalars only, document order, deduped.
 */
function conflictingReadings(store: LedgerStore, elementId: string, cache?: RenderCache): string[] {
  const hit = cache?.readings?.get(elementId);
  if (hit) return hit;
  const out: string[] = [];
  for (const c of store.claims()) {
    if (!isLive(c) || c.value.kind !== "scalar") continue;
    if (elementIdOf(c.about) !== elementId || !slotOf(c.about).startsWith(READING_SLOT_PREFIX)) continue;
    const v = String(c.value.value).trim();
    if (v && !out.includes(v)) out.push(v);
  }
  if (cache) (cache.readings ??= new Map()).set(elementId, out);
  return out;
}

/**
 * The meaning question. When the ledger RECORDS rival readings for this element —
 * a terminology collision migrated from the ontology's `ambiguities[]` — they are
 * NAMED, because nobody can choose between readings they were never shown. Fewer
 * than two recorded readings ⇒ the plain ask: a rival is never invented to fill the
 * template, so the question is honest either way.
 */
const meaningQuestion = (name: string, readings: readonly string[]): string =>
  readings.length > 1
    ? `What does ${name} mean, exactly? The record carries it ${readings.length} ways — ${readings.map((r) => `“${r}”`).join(" · ")} — which meaning should it adopt?`
    : `What does ${name} mean, exactly?`;

/** Element display name, ORIGINAL casing, attribute qualified by its parent —
 *  full, never truncated (display ellipsis is the surface's job). */
function nameFor(store: LedgerStore, el: LedgerElement | undefined, elementId: string, byId: Map<string, LedgerElement>): string {
  if (!el) {
    const tail = elementId.replace(/^el:/, "").split(":").pop() ?? elementId;
    return tail.replace(/[.#_-]+/g, " ").trim();
  }
  if ((el.kind === "attribute") && el.of) {
    const parent = byId.get(el.of);
    return parent?.name ? `${parent.name}.${el.name}` : el.name;
  }
  return el.name;
}

/**
 * A PER-PASS index, supplied by callers that render many loci at once.
 *
 * `renderQuestion` rebuilt `new Map(store.elements())` on EVERY call, and
 * `conflictingReadings` walked every claim for every `#semantics` locus. A pass
 * over Q loci therefore cost O(Q · (E + C)) — quadratic in programme size.
 * Measured at 10x the largest real programme (4,100 questions / 3,300 elements):
 * one full render took ~690 ms, a x73 blow-up over 1x (validation pass 2, N-6).
 *
 * The cache is EXPLICIT and PER-PASS rather than memoised on the store, and that
 * is the safety property: `store.elements()` returns a fresh array each call, so
 * there is nothing stable to key on, and a length-check cache would silently
 * serve a stale name after an element was RENAMED. A cache that lives for one
 * pass cannot go stale — it is built and discarded inside a single synchronous
 * render, so it observes one consistent view of the store by construction.
 *
 * Omitting it changes nothing but speed: every call without a cache behaves
 * exactly as before. The real fix for the remaining term is an index on `about`
 * in `store.ts` (`liveClaimsAbout` filters the whole claim map per insert), and
 * that is frozen core — recorded as finding N-6, not done here.
 */
export interface RenderCache {
  byId?: Map<string, LedgerElement>;
  readings?: Map<string, string[]>;
}

export const createRenderCache = (): RenderCache => ({});

/** The element index, built once per pass when a cache is supplied. */
/**
 * The confident lifecycle loci, memoised per store.
 *
 * `lifecycleEntities` walks every element, and renderQuestion is called once per
 * question on a board that can hold hundreds — so it is computed once per store and
 * held weakly, which is the same trick `elementIndex` below already plays.
 */
const LIFECYCLE_CACHE = new WeakMap<LedgerStore, Set<string>>();
const lifecycleAbouts = (store: LedgerStore): Set<string> => {
  const hit = LIFECYCLE_CACHE.get(store);
  if (hit) return hit;
  const set = lifecycleLoci(store);
  LIFECYCLE_CACHE.set(store, set);
  return set;
};

/** The entity a locus belongs to, by name — an attribute's parent, or the element. */
const entityOf = (store: LedgerStore, elementId: string, byId: Map<string, LedgerElement>): string => {
  const el = byId.get(elementId);
  if (!el) return "";
  return (el.kind === "attribute" && el.of ? byId.get(el.of)?.name : el.name) ?? "";
};

const elementIndex = (store: LedgerStore, cache?: RenderCache): Map<string, LedgerElement> => {
  if (cache?.byId) return cache.byId;
  const built = new Map(store.elements().map((e) => [e.id, e] as const));
  if (cache) cache.byId = built;
  return built;
};

export function renderQuestion(store: LedgerStore, about: string, audience: Audience, cache?: RenderCache): RenderedQuestion {
  const elementId = elementIdOf(about);
  const kind = slotOf(about);
  const byId = elementIndex(store, cache);
  const el = byId.get(elementId);
  const your = audience === "stakeholder" ? "your" : "the";

  let question: string;
  /** The subject this phrasing states up front, when it states one — what a
   *  grouped card's header already carries. */
  let stem = "";

  if (el?.kind === "step") {
    // FULL action text from the #action claim — the element name is a 60-char cut.
    const action = (scalarAt(store, `${elementId}#action`) ?? el.name).trim().replace(/[.\s]+$/, "");
    const quoted = `One step in ${your} process is: "${action}."`;
    stem = quoted;
    question =
      kind === "automationDisposition" ? `${quoted} Should this be automated, assisted, or stay manual?`
        : kind === "actorRole" ? `${quoted} Who does this step?`
          : kind === "decision" ? `${quoted} What decides the outcome?`
            : `${quoted} ${fallbackTail(kind)}`;
  } else if (el?.kind === "relation") {
    // Plain language, never arrow notation — resolve BOTH endpoint names.
    const from = byId.get(el.refs?.from ?? "")?.name ?? "one thing";
    const to = byId.get(el.refs?.to ?? "")?.name ?? "another";
    question =
      kind === "cardinality" ? `Can one ${from} have many ${to}, or just one?`
        : kind === "optionality" ? `Does every ${from} need a ${to}, or is that optional?`
          // No "in your/the world" preamble. It read as filler to a stakeholder
          // and as broken English to an operator, for whom `your` resolves to
          // "the" — "In the world, what does the connection…". Dropping it also
          // makes a RELATION's meaning question parallel with an entity's
          // ("What does X mean, exactly?"), which is the same question asked of
          // a different kind of thing and should sound like it.
          : kind === "semantics" ? `What does the connection between ${from} and ${to} mean, exactly?`
            : `About the connection between ${from} and ${to} — ${fallbackTail(kind)}`;
  } else {
    // Entities, attributes, workflows — names verbatim, original casing.
    const name = nameFor(store, el, elementId, byId);
    question =
      kind === "phase" ? `At what point in ${your} work does "${name}" happen?`
        // A LIFECYCLE IS NOT A PICKLIST. "What values can Opportunity.stage take?"
        // is a schema question, asked of whoever exports the schema. The same locus,
        // put to the person who moves the thing, is "what stages does it go
        // through, in order" — and the ORDER is the part a dictionary never carries
        // and only they can give.
        // A LIFECYCLE IS NOT A PICKLIST, and it is not the ENTITY either. Naming only
        // the entity — "What stages does Opportunity go through?" — sent the SAME
        // sentence three times on Laila New, where Opportunity carries `stage`,
        // `forecast status` and `MSA status`, with nothing to tell the recipient which
        // field each was about. The full name leads, exactly as every other question
        // here carries it; the entity follows because "what stages does an Opportunity
        // move through" is the sentence a person actually answers.
        : kind === "valueSet" ? (lifecycleAbouts(store).has(about)
          ? `${name} — what stages does ${entityOf(store, elementId, byId) || "it"} move through, in order?`
          : `What values can ${name} take?`)
          : kind === "dataType" ? `What type of value is ${name}?`
            : kind === "optionality" ? `Is ${name} required or optional?`
              : kind === "semantics" ? meaningQuestion(name, conflictingReadings(store, elementId, cache))
                : kind === "trigger" ? `What starts "${name}"?`
                  : kind === "owner" ? `Who owns ${name}?`
                    : kind === "systemOfRecord" ? `Which system is the source of record for ${name}?`
                      : kind === "exists" ? `Does ${name} still exist in the to-be design?`
                        : kind === "area" ? `Which area does ${name} belong to?`
                          : kind === "decision" ? `What decides the outcome of ${name}?`
                            : `About ${name} — ${fallbackTail(kind)}`;
  }

  const elementName = el?.kind === "step"
    ? (scalarAt(store, `${elementId}#action`) ?? el.name)
    : nameFor(store, el, elementId, byId);
  // `short` drops the stem for a surface whose header already names the subject.
  const short = stem && question.startsWith(stem) ? question.slice(stem.length).trim() : question;
  return { id: about, elementId, elementName, kind, label: questionLabel(kind), question, short, affordance: affordanceFor(kind) };
}

const fallbackTail = (kind: string): string => `${questionLabel(kind).toLowerCase()}?`;

/**
 * Grounded options for a PICKER affordance — the values the ledger ALREADY HOLDS
 * at loci of this kind (live scalar claims), never an invented vocabulary. An
 * empty list is the honest answer when the ledger states none: the surface falls
 * back to free text rather than offering a made-up menu. (Chips are the
 * exception — Automate/Assist/Keep manual IS the disposition vocabulary, and it
 * is carried on the affordance itself.)
 */
export function affordanceOptions(store: LedgerStore, kind: string): string[] {
  const out = new Set<string>();
  for (const c of store.claims()) {
    if (!isLive(c) || c.value.kind !== "scalar" || slotOf(c.about) !== kind) continue;
    const v = String(c.value.value).trim();
    if (v && v.length <= 60) out.add(v);
  }
  return [...out].sort((a, b) => a.localeCompare(b)).slice(0, 24);
}

/** Stakeholder grouping: one card per ELEMENT (a step card), its unknowns as
 *  sub-questions. The unit stays QUESTIONS — the group header shows the count. */
export interface QuestionGroup { elementId: string; header: string; questions: RenderedQuestion[]; count: number; }
export function groupQuestions(store: LedgerStore, abouts: readonly string[], audience: Audience): QuestionGroup[] {
  const cache = createRenderCache();
  const byEl = new Map<string, RenderedQuestion[]>();
  for (const about of abouts) {
    const q = renderQuestion(store, about, audience, cache);
    (byEl.get(q.elementId) ?? byEl.set(q.elementId, []).get(q.elementId)!).push(q);
  }
  const byId = elementIndex(store, cache);
  return [...byEl.entries()].map(([elementId, questions]) => {
    const el = byId.get(elementId);
    const header = el?.kind === "step"
      ? (scalarAt(store, `${elementId}#action`) ?? el.name)
      : nameFor(store, el, elementId, byId);
    return { elementId, header, questions, count: questions.length };
  }).sort((a, b) => b.count - a.count || a.header.localeCompare(b.header));
}
