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
