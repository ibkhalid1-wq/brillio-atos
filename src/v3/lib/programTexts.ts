/**
 * Transcript externalization — the pure split/merge core.
 *
 * A programme's large free-text capture fields (transcripts) bloat the single
 * `data` JSONB blob, so writes hit Postgres's statement timeout. The plan
 * (docs/transcript-externalization.md) keeps the synchronous single-blob READ
 * model: on load the externalized texts are MERGED back into `phaseInputs`; on
 * write they are SPLIT back out into their own table so the blob stays small.
 *
 * This module is the split/merge logic ONLY — pure, side-effect-free, and not
 * yet wired into the persist/hydrate/edge paths. `split(merge(x)) === x` and
 * `merge(split(x)) === x` for the externalized fields, so a round trip is
 * byte-identical to the old inline read (the migration's correctness gate).
 */

/** The large free-text capture fields, by name — source of truth is the
 * `captureField` values in flowMeetings.ts. Externalized wherever they appear
 * under `phaseInputs.<movement>`, regardless of which movement bucket holds
 * them (a field can be written to more than one movement over a programme's
 * life). */
export const EXTERNALIZED_FIELD_NAMES = new Set<string>([
  "sponsorConversation",
  "interviewTranscripts",
  "steeringConversation",
  "demoFeedback",
  "shipConversations",
  "opsConversations",
]);

/** Only externalize genuinely large values — a short note isn't worth a row. */
export const MIN_EXTERNAL_LEN = 2000;

export interface ExternalText {
  fieldKey: string;
  movementId: string;
  content: string;
}

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

/**
 * Pull every large externalizable field out of `inner.phaseInputs.<movement>`,
 * returning a shrunk copy of `inner` (the field keys removed) and the extracted
 * texts. Non-externalizable and small fields are untouched.
 */
export function splitExternalTexts(inner: Record<string, unknown>): {
  inner: Record<string, unknown>;
  texts: ExternalText[];
} {
  const next = clone(inner);
  const texts: ExternalText[] = [];
  const phaseInputs = isRecord(next.phaseInputs) ? next.phaseInputs : null;
  if (!phaseInputs) return { inner: next, texts };
  for (const [movementId, bucketRaw] of Object.entries(phaseInputs)) {
    if (!isRecord(bucketRaw)) continue;
    const bucket = bucketRaw;
    for (const fieldKey of Object.keys(bucket)) {
      if (!EXTERNALIZED_FIELD_NAMES.has(fieldKey)) continue;
      const value = bucket[fieldKey];
      if (typeof value !== "string" || value.length < MIN_EXTERNAL_LEN) continue;
      texts.push({ fieldKey, movementId, content: value });
      delete bucket[fieldKey];
    }
  }
  return { inner: next, texts };
}

/**
 * Merge externalized texts back into `inner.phaseInputs.<movement>.<field>`,
 * reconstructing the full in-memory blob the synchronous readers expect. A text
 * whose bucket is missing is created; an inline value already present is NOT
 * overwritten (inline wins during the dual-read transition, so a stale table
 * row can never clobber a fresher inline edit).
 */
export function mergeExternalTexts(
  inner: Record<string, unknown>,
  texts: ExternalText[],
): Record<string, unknown> {
  if (!texts.length) return inner;
  const next = clone(inner);
  const phaseInputs = isRecord(next.phaseInputs)
    ? next.phaseInputs
    : (next.phaseInputs = {} as Record<string, unknown>);
  const pi = phaseInputs as Record<string, unknown>;
  for (const { fieldKey, movementId, content } of texts) {
    const bucket = isRecord(pi[movementId]) ? (pi[movementId] as Record<string, unknown>) : (pi[movementId] = {});
    const b = bucket as Record<string, unknown>;
    if (typeof b[fieldKey] === "string" && (b[fieldKey] as string).length >= MIN_EXTERNAL_LEN) continue;
    b[fieldKey] = content;
  }
  return next;
}

/** True when `inner` still carries an externalizable field inline (i.e. it has
 * NOT been split yet) — used to decide whether a write needs a split pass. */
export function hasInlineExternalText(inner: Record<string, unknown>): boolean {
  const phaseInputs = isRecord(inner.phaseInputs) ? inner.phaseInputs : null;
  if (!phaseInputs) return false;
  for (const bucketRaw of Object.values(phaseInputs)) {
    if (!isRecord(bucketRaw)) continue;
    for (const [fieldKey, value] of Object.entries(bucketRaw)) {
      if (EXTERNALIZED_FIELD_NAMES.has(fieldKey) && typeof value === "string" && value.length >= MIN_EXTERNAL_LEN) {
        return true;
      }
    }
  }
  return false;
}
