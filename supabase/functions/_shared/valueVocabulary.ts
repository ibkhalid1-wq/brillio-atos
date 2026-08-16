/**
 * THE PICKLIST THE SEEDER NEVER HAD — a per-programme value vocabulary, stored
 * as an artifact and consumed deterministically.
 *
 * WHAT WAS WRONG. The seeder's category vocabulary is entity-blind: one pool of
 * twelve neutral words ("Standard", "Priority", "Managed", …) supplies every
 * category-shaped column in the ontology, rotated by a hash of the attribute
 * name so a single row does not print one word six times. On a reviewed CRM
 * build that renders `Region: Managed`, `Industry: Priority`, `Tier: Standard`
 * — three fields, one pool, and every one of them saying a word that belongs to
 * a different field. A stakeholder reads the value, not the mechanism, and what
 * they read is a system that does not know what a region is.
 *
 * WHY A MODEL, AND WHY NOT AT BUILD TIME. Knowing that a Region is
 * "EMEA / North America / APAC" and a stage is "Qualified / Proposal /
 * Closed-Won" is domain judgement — exactly the thing a model has and a
 * deterministic derivation does not. But a model call inside the build would
 * make the build non-reproducible: the same ontology would render different
 * values on every rebuild, and `fabricVersion` equality would stop meaning that
 * two prototypes are the same prototype.
 *
 * So the vocabulary is an INPUT, not a generation step. One call per ONTOLOGY
 * CHANGE produces `{ "Entity.attribute": ["plausible", "values"] }`; that object
 * is stored, reviewable and diffable next to the ontology it answers; and the
 * seeder reads it the way it reads the ontology — as data. Rebuilding calls no
 * model and cannot move a value.
 *
 * THREE PROPERTIES THIS MODULE EXISTS TO HOLD:
 *
 *  1. ABSENT IS EXACTLY AS BEFORE. No vocabulary, an empty one, or one that
 *     answers nothing this ontology asked — all three resolve to `null`, the
 *     seeder takes its generic pools, and the output is byte-for-byte what it
 *     was. The feature can be off and nothing about the build changes.
 *  2. PRESENT IS STILL DETERMINISTIC. Values are chosen from the supplied list
 *     by the SAME seeded draw that chose from the generic pool, so a covered
 *     field changes and an uncovered one does not move by a single byte.
 *  3. A MISS STAYS VISIBLE. Fields the artifact does not answer, keys it answers
 *     that this ontology no longer has, and a fingerprint that no longer matches
 *     the ontology are all reported — as warnings from the parse, and as a
 *     declared assumption in the seed. Silence would let a stale vocabulary look
 *     like a current one.
 *
 * NO MODEL CALL HAPPENS HERE. `vocabularyRequest` builds the prompt and
 * `generateValueVocabulary` takes the completion function as an argument, so the
 * whole path is exercisable — request, parse, sanitise, fingerprint — with a
 * function that returns a string. The caller owns the transport.
 */
import { deriveRoles, type ValueRole } from "./semanticRoles.ts";

/** The value roles a picklist can answer for. These are the roles whose values
 *  are a CLOSED SET a person reads — a status, a category, a health, a
 *  priority. A monetary amount or a date has no vocabulary; a title is a name,
 *  not a choice. */
export const VOCABULARY_ROLES = ["category", "status", "health", "priority"] as const;
export type VocabularyRole = (typeof VOCABULARY_ROLES)[number];
const isVocabularyRole = (r: ValueRole | undefined): r is VocabularyRole =>
  !!r && (VOCABULARY_ROLES as readonly string[]).includes(r);

/** One field that wants a vocabulary: where it lives, why it qualifies, and the
 *  key both the prompt and the artifact address it by. */
export interface VocabularyTarget {
  entity: string;
  attribute: string;
  role: VocabularyRole;
  /** `Entity.attribute` — the artifact's key. */
  key: string;
}

/**
 * The stored artifact. `ontology` is the fingerprint of the field set this
 * vocabulary was generated for: it is what makes "one call per ontology change"
 * checkable rather than a habit. Same ontology surface → same fingerprint → no
 * call. A new entity, a new category attribute, or an attribute whose role
 * changed → new fingerprint → the artifact is stale and says so.
 */
export interface ValueVocabulary {
  kind: "value-vocabulary";
  ontology: string;
  values: Record<string, string[]>;
}

/** The vocabulary as a consumer uses it, plus everything it could not answer. */
export interface ResolvedVocabulary {
  /** `Entity.attribute` → the values to draw from. Only keys this ontology asked for. */
  values: Map<string, string[]>;
  /** Was this artifact generated for the field set in front of us? */
  current: boolean;
  /** The fingerprint the artifact carries, when it carries one. */
  fingerprint: string;
  /** Fields that wanted a vocabulary and did not get one — the generic pool
   *  still supplies them, and that is a Listen question, not a finish. */
  missing: VocabularyTarget[];
  /** Fields it answered. */
  covered: VocabularyTarget[];
}

export const vocabularyKey = (entity: string, attribute: string): string => `${entity}.${attribute}`;

/** How many values one field may carry, and how long one value may be. A
 *  picklist is a short list of short labels; anything else is prose that got
 *  into the wrong field. */
const MAX_VALUES = 12;
const MAX_VALUE_LENGTH = 48;
const MIN_VALUES = 2;

// The same FNV-1a the seed and the fabric use for their hashes — one hashing
// habit across the cluster, and no dependency added for it.
function hash(s: string): string {
  let h = 2166136261 >>> 0;
  for (let i = 0; i < s.length; i += 1) { h ^= s.charCodeAt(i); h = Math.imul(h, 16777619); }
  return (h >>> 0).toString(36);
}

/**
 * Every field in this ontology that wants a vocabulary, in the ontology's own
 * order. Derived from the SAME `deriveRoles` the seeder consults, so the prompt
 * cannot ask about a field the seeder would never look up, and the seeder cannot
 * look up a field the prompt never asked about.
 */
export function vocabularyTargets(ontology: Record<string, unknown>): VocabularyTarget[] {
  const roles = deriveRoles(ontology);
  const out: VocabularyTarget[] = [];
  for (const r of roles.attributeRoles) {
    if (!isVocabularyRole(r.role) || !r.entity || !r.attribute) continue;
    out.push({ entity: r.entity, attribute: r.attribute, role: r.role, key: vocabularyKey(r.entity, r.attribute) });
  }
  return out;
}

/**
 * The fingerprint of the vocabulary-relevant ontology surface: which fields ask
 * for values, and what kind of value each asks for. It moves when the QUESTION
 * moves and not otherwise — renaming an unrelated entity's monetary column does
 * not invalidate a perfectly good picklist, and adding a status attribute does.
 */
export function ontologyVocabularyFingerprint(ontology: Record<string, unknown>): string {
  const targets = vocabularyTargets(ontology);
  return hash(targets.map((t) => `${t.key}|${t.role}`).join("\n"));
}

export interface VocabularyRequest {
  system: string;
  user: string;
  targets: VocabularyTarget[];
  /** The fingerprint the produced artifact will carry. */
  fingerprint: string;
}

/**
 * The one model call, as a value. Nothing here talks to a network: the caller
 * hands `system`/`user` to whatever transport it has, and hands the reply to
 * `parseValueVocabulary`. Keeping the request a value is what makes the whole
 * path testable without a model — and what lets a human read, edit and re-run
 * the exact prompt that produced a stored artifact.
 */
export function vocabularyRequest(ontology: Record<string, unknown>): VocabularyRequest {
  const targets = vocabularyTargets(ontology);
  const domain = String((ontology as { domain?: unknown; summary?: unknown }).domain
    ?? (ontology as { summary?: unknown }).summary ?? "").trim();
  const byEntity = new Map<string, VocabularyTarget[]>();
  for (const t of targets) (byEntity.get(t.entity) ?? byEntity.set(t.entity, []).get(t.entity)!).push(t);
  const fields = [...byEntity.entries()]
    .map(([entity, list]) => `- ${entity}: ${list.map((t) => `${t.attribute} (${t.role})`).join(", ")}`)
    .join("\n");
  const system = [
    "You supply picklist values for a synthetic demonstration dataset built from a client's domain ontology.",
    "For each field you are given, return the values that field would plausibly hold in that business.",
    "Rules:",
    `- Between ${MIN_VALUES} and ${MAX_VALUES} values per field, each a short label a person reads (at most ${MAX_VALUE_LENGTH} characters).`,
    "- Values must belong to THEIR OWN field. A region is a place; an industry is a sector; a stage is a step in a lifecycle.",
    "- Use the ordinary vocabulary of the domain, in the order the business would list them (a lifecycle in lifecycle order).",
    "- Invent no real organisation, person or place-specific identifier. Generic industry vocabulary only.",
    "- Omit a field entirely rather than guess. An omitted field falls back to a neutral pool; a wrong value is worse.",
    'Reply with JSON only: an object mapping "Entity.attribute" to an array of strings. No prose, no markdown fence.',
  ].join("\n");
  const user = [
    domain ? `Domain: ${domain}` : "",
    "Fields needing values:",
    fields || "(none)",
    "",
    'Example of the expected shape: {"Opportunity.stage":["Qualified","Proposal","Negotiation","Closed-Won","Closed-Lost"]}',
  ].filter(Boolean).join("\n");
  return { system, user, targets, fingerprint: ontologyVocabularyFingerprint(ontology) };
}

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/** Strip a markdown fence if the model wrapped its JSON in one, then parse. */
function readJson(raw: unknown): unknown {
  if (isRecord(raw) || Array.isArray(raw)) return raw;
  const text = String(raw ?? "").trim();
  if (!text) return undefined;
  const fenced = text.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/, "").trim();
  const start = fenced.indexOf("{");
  const end = fenced.lastIndexOf("}");
  const body = start >= 0 && end > start ? fenced.slice(start, end + 1) : fenced;
  try { return JSON.parse(body); } catch { return undefined; }
}

export interface ParsedVocabulary {
  vocabulary: ValueVocabulary;
  /** Everything discarded, and why. A silently-dropped key is a value nobody
   *  can explain the absence of six weeks later. */
  warnings: string[];
}

/**
 * Turn a model reply (or a stored artifact, or a hand-written one) into a
 * vocabulary this ontology can actually use. Tolerant of shape — a bare map, a
 * `{values:{…}}` wrapper, or a full artifact all parse — and strict about
 * content: a key this ontology does not ask for is dropped, a value that is not
 * a short string is dropped, duplicates collapse, and a field left with fewer
 * than two usable values is dropped whole (a one-item picklist prints the same
 * word down the column, which is the defect this exists to fix).
 */
export function parseValueVocabulary(raw: unknown, ontology: Record<string, unknown>): ParsedVocabulary {
  const warnings: string[] = [];
  const parsed = readJson(raw);
  const body = isRecord(parsed) && isRecord(parsed.values) ? parsed.values : parsed;
  const targets = new Map(vocabularyTargets(ontology).map((t) => [t.key, t] as const));
  const values: Record<string, string[]> = {};
  if (!isRecord(body)) {
    warnings.push("no JSON object could be read from the reply");
    return { vocabulary: { kind: "value-vocabulary", ontology: ontologyVocabularyFingerprint(ontology), values }, warnings };
  }
  for (const [key, listed] of Object.entries(body)) {
    if (!targets.has(key)) { warnings.push(`"${key}" is not a field this ontology asks values for — dropped`); continue; }
    if (!Array.isArray(listed)) { warnings.push(`"${key}" is not a list of values — dropped`); continue; }
    const seen = new Set<string>();
    const clean: string[] = [];
    for (const v of listed) {
      if (typeof v !== "string") continue;
      const t = v.trim();
      if (!t || t.length > MAX_VALUE_LENGTH) continue;
      const k = t.toLowerCase();
      if (seen.has(k)) continue;
      seen.add(k);
      clean.push(t);
      if (clean.length >= MAX_VALUES) break;
    }
    if (clean.length < MIN_VALUES) { warnings.push(`"${key}" kept ${clean.length} usable value(s) — dropped, the generic pool answers it`); continue; }
    values[key] = clean;
  }
  return { vocabulary: { kind: "value-vocabulary", ontology: ontologyVocabularyFingerprint(ontology), values }, warnings };
}

/**
 * THE ONE MODEL CALL, with the transport injected.
 *
 * `complete` is whatever the caller has — the edge function's Claude client, a
 * replay fixture, a stub in a test. This module never imports one, so the
 * generation path is exercised end to end in the suite and nothing here can
 * make a network call by accident.
 *
 * Call it when `ontologyVocabularyFingerprint` no longer matches the stored
 * artifact's — that is the whole trigger, and it is a pure comparison.
 */
export async function generateValueVocabulary(
  ontology: Record<string, unknown>,
  complete: (request: VocabularyRequest) => Promise<string>,
): Promise<ParsedVocabulary & { request: VocabularyRequest }> {
  const request = vocabularyRequest(ontology);
  if (!request.targets.length) {
    return { request, vocabulary: { kind: "value-vocabulary", ontology: request.fingerprint, values: {} },
      warnings: ["this ontology has no category, status, health or priority field — nothing to ask for"] };
  }
  const reply = await complete(request);
  const parsed = parseValueVocabulary(reply, ontology);
  return { ...parsed, request };
}

/**
 * THE KEY EVERY CONSUMER READS THE ARTIFACT BY. The seeder gets the vocabulary
 * from whoever assembles; the operator's studio, the stakeholder's pilot and the
 * refine baseline all take it off the programme blob under this one name. The
 * producer writes the same name — a producer and a consumer that disagree about
 * where the artifact lives is exactly the failure this whole module exists after.
 */
export const VOCABULARY_FIELD_KEY = "prototypeValueVocabulary";

/**
 * The artifact as the SEEDER sees it: a lookup, plus the two facts that decide
 * whether anyone should trust it — is it current, and what did it not answer.
 *
 * Returns `null` for anything that cannot change a single value: absent,
 * unreadable, or answering nothing this ontology asked. That is what keeps the
 * absent case byte-identical — the consumer takes one branch, not a lookup that
 * happens to miss on every key.
 */
export function resolveVocabulary(artifact: unknown, ontology: Record<string, unknown>): ResolvedVocabulary | null {
  if (artifact == null) return null;
  const { vocabulary } = parseValueVocabulary(artifact, ontology);
  const values = new Map(Object.entries(vocabulary.values));
  if (!values.size) return null;
  const targets = vocabularyTargets(ontology);
  const declared = isRecord(artifact) && typeof (artifact as { ontology?: unknown }).ontology === "string"
    ? String((artifact as { ontology: string }).ontology) : "";
  return {
    values,
    fingerprint: declared,
    // No declared fingerprint is not a mismatch — a hand-written vocabulary is a
    // legitimate artifact. A declared one that disagrees IS: the ontology has
    // moved since the call, and somebody needs to know before the values are read
    // as current.
    current: !declared || declared === ontologyVocabularyFingerprint(ontology),
    missing: targets.filter((t) => !values.has(t.key)),
    covered: targets.filter((t) => values.has(t.key)),
  };
}

/* ───────────────────────────────────────────────────────────────────────────
 * THE PRODUCER
 *
 * Everything above is the CONSUMER side — and for a while that was all there
 * was. The seeder read `opts.vocabulary`, the studio and the stakeholder's pilot
 * passed the stored artifact, and NOTHING ANYWHERE WROTE ONE: three readers,
 * zero writers, so the defect this module is named after ("Region: Managed.
 * Industry: Priority. Tier: Standard.") was still on every build. A feature with
 * no producer is not a feature; it is plumbing with the water off.
 *
 * What follows is the producer, and it is pure. The decision (call or don't),
 * the prompt, the parse and the stored document are all values computed from the
 * programme blob — the edge function contributes a transport and a place to
 * write, nothing else. That is what makes "one call per ontology change" a
 * testable property instead of a promise: the suite runs the whole producer with
 * a counting stub and asserts the model was asked exactly once.
 * ─────────────────────────────────────────────────────────────────────────── */

/** Whether to spend the one call, and why — the whole gate, as a value. */
export interface VocabularyPlan {
  /** Ask the model? */
  run: boolean;
  /** Why, in a sentence an operator reads on the run. Never empty. */
  reason: string;
  /** The fingerprint of the ontology surface in front of us right now. */
  fingerprint: string;
  /** The fingerprint the stored artifact carries — "" when there is none. */
  storedFingerprint: string;
  /** The request to send, when there is one to send. */
  request: VocabularyRequest | null;
}

/**
 * ONE CALL PER ONTOLOGY CHANGE, decided here.
 *
 * The trigger is a fingerprint comparison, not a habit and not a timestamp: the
 * artifact declares the ontology surface it was generated for, and if that is
 * still the surface in front of us there is nothing to ask. Everything else —
 * no ontology, no closed-set field, a stored vocabulary that answers nothing —
 * is a SKIP WITH A REASON, because a producer that declines in silence is
 * indistinguishable from one that is broken.
 *
 * `force` is the operator saying "do it anyway"; the automatic follow-on never
 * passes it, which is precisely what keeps the call count at one per change.
 */
export function planValueVocabulary(
  inner: Record<string, unknown>,
  opts: { force?: boolean } = {},
): VocabularyPlan {
  const ontology = isRecord(inner.domainOntology) ? inner.domainOntology : null;
  const stored = inner[VOCABULARY_FIELD_KEY];
  const storedFingerprint = isRecord(stored) && typeof stored.ontology === "string" ? stored.ontology : "";
  if (!ontology) {
    return {
      run: false,
      reason: "there is no domain ontology on the record yet — the vocabulary answers the ontology's own fields, so there is nothing to ask about",
      fingerprint: "",
      storedFingerprint,
      request: null,
    };
  }
  const request = vocabularyRequest(ontology);
  const base = { fingerprint: request.fingerprint, storedFingerprint };
  if (!request.targets.length) {
    return {
      ...base,
      run: false,
      reason: "this ontology has no category, status, health or priority field — nothing to ask for",
      request: null,
    };
  }
  // A stored artifact only counts as PRODUCED if it can change a value. One that
  // parses to nothing usable (the model refused, the reply was prose, every key
  // it answered has since left the ontology) resolves to `null` for the seeder,
  // so treating it as an answer would leave the programme permanently on the
  // generic pool with no way back.
  const usable = resolveVocabulary(stored, ontology);
  if (!usable) {
    return {
      ...base,
      run: true,
      reason: storedFingerprint
        ? "the stored vocabulary answers no field this ontology asks about"
        : "no value vocabulary has been produced for this ontology yet",
      request,
    };
  }
  if (storedFingerprint && storedFingerprint !== request.fingerprint) {
    return { ...base, run: true, reason: "the ontology's fields have changed since the stored vocabulary was generated", request };
  }
  if (opts.force) {
    return { ...base, run: true, reason: "regenerating the vocabulary on request", request };
  }
  return {
    ...base,
    run: false,
    reason: `the stored vocabulary was generated for this exact ontology surface (${request.fingerprint}) — one call per ontology change means no call now`,
    request: null,
  };
}

/**
 * The stored DOCUMENT — the artifact a human opens, diffs and edits.
 *
 * It is the consumer's shape with the receipts attached: `values` and `ontology`
 * are what `resolveVocabulary` reads, and `gaps` / `warnings` / `summary` are why
 * anyone should believe it. No clock and no id generation here — the caller
 * stamps `generatedAt` — so the same reply always yields the same document and a
 * diff between two versions is a diff in the VALUES, not in the metadata.
 */
export function valueVocabularyDocument(
  parsed: ParsedVocabulary,
  ontology: Record<string, unknown>,
): Record<string, unknown> {
  const targets = vocabularyTargets(ontology);
  const values = parsed.vocabulary.values;
  const answered = (t: VocabularyTarget) => Array.isArray(values[t.key]) && values[t.key].length > 0;
  const covered = targets.filter(answered);
  const missing = targets.filter((t) => !answered(t));
  return {
    title: "Value Vocabulary",
    kind: "value-vocabulary",
    ontology: parsed.vocabulary.ontology,
    values,
    // The fields it answered, spelled out per field so the document reads as a
    // picklist review and not as a blob of JSON.
    fields: covered.map((t) => ({ key: t.key, entity: t.entity, attribute: t.attribute, role: t.role, values: values[t.key] })),
    // A MISS STAYS VISIBLE, here as well as in the seed's assumptions: a field
    // left on the generic pool is a Listen question, not a finished answer.
    gaps: missing.map((t) => `${t.key} (${t.role}) has no supplied values — the generic pool answers it; ask what values it really holds`),
    warnings: parsed.warnings,
    summary: `${covered.length} of ${targets.length} closed-set field${targets.length === 1 ? "" : "s"} carry programme values`,
    confidence: targets.length ? Math.round((covered.length / targets.length) * 100) / 100 : 0,
  };
}

/** What the producer did, as a value the caller stores and reports. */
export interface VocabularyOutcome {
  status: "generated" | "skipped";
  /** Why it ran or did not — the plan's reason, carried through to the run row. */
  reason: string;
  /** The document to store, or null when nothing was produced. */
  document: Record<string, unknown> | null;
  warnings: string[];
  summary: string;
  confidence: number | null;
}

/**
 * THE PRODUCER, END TO END, WITHOUT A TRANSPORT.
 *
 * Give it the programme's inner blob and a function that can complete a prompt;
 * it decides whether to ask, asks at most once, sanitises the reply and returns
 * the document to store. `complete` is NEVER called on a skip — that is the
 * property the whole "one call per ontology change" claim reduces to, and it is
 * checkable with a counter.
 */
export async function produceValueVocabulary(
  inner: Record<string, unknown>,
  complete: (request: VocabularyRequest) => Promise<string>,
  opts: { force?: boolean } = {},
): Promise<VocabularyOutcome> {
  const plan = planValueVocabulary(inner, opts);
  if (!plan.run || !plan.request) {
    return { status: "skipped", reason: plan.reason, document: null, warnings: [], summary: plan.reason, confidence: null };
  }
  const ontology = inner.domainOntology as Record<string, unknown>;
  const parsed = parseValueVocabulary(await complete(plan.request), ontology);
  const document = valueVocabularyDocument(parsed, ontology);
  return {
    status: "generated",
    reason: plan.reason,
    document,
    warnings: parsed.warnings,
    summary: String(document.summary ?? ""),
    confidence: typeof document.confidence === "number" ? document.confidence : null,
  };
}
