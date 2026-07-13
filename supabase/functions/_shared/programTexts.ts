/**
 * Transcript externalization — Deno port of the pure split/merge core.
 *
 * Kept in LOCKSTEP with src/v3/lib/programTexts.ts (the client copy): the two
 * must round-trip a blob identically, since the client splits on write and the
 * edge merges on read (and, once cutover is enabled, splits on its own writes).
 * If you change one, change the other. See docs/transcript-externalization.md.
 */

/** The large free-text capture fields, by name — source of truth is the
 * `captureField` values in the client's flowMeetings.ts. */
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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

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
 * reconstructing the full in-memory blob the readers expect. An inline value
 * already present (and still large) is NOT overwritten — inline wins, so a stale
 * table row can never clobber a fresher inline edit.
 */
export function mergeExternalTexts(
  inner: Record<string, unknown>,
  texts: ExternalText[],
): Record<string, unknown> {
  if (!texts.length) return inner;
  const next = clone(inner);
  const pi = isRecord(next.phaseInputs)
    ? (next.phaseInputs as Record<string, unknown>)
    : (next.phaseInputs = {} as Record<string, unknown>) as Record<string, unknown>;
  for (const { fieldKey, movementId, content } of texts) {
    const bucket = isRecord(pi[movementId]) ? (pi[movementId] as Record<string, unknown>) : (pi[movementId] = {});
    const b = bucket as Record<string, unknown>;
    if (typeof b[fieldKey] === "string" && (b[fieldKey] as string).length >= MIN_EXTERNAL_LEN) continue;
    b[fieldKey] = content;
  }
  return next;
}

/**
 * Resolve the object that directly holds `phaseInputs` inside a raw
 * `adam_programs.data` blob — either the blob itself (flat programmes) or its
 * nested `.data` (nested-data programmes). Returns null when neither carries
 * phaseInputs, so callers can no-op safely.
 */
export function resolvePhaseInputsContainer(
  data: unknown,
): Record<string, unknown> | null {
  if (!isRecord(data)) return null;
  if (isRecord(data.data) && isRecord((data.data as Record<string, unknown>).phaseInputs)) {
    return data.data as Record<string, unknown>;
  }
  if (isRecord(data.phaseInputs)) return data;
  // No phaseInputs yet, but a nested inner exists → prefer it so a later merge
  // lands where the client would have split from.
  if (isRecord(data.data)) return data.data as Record<string, unknown>;
  return data;
}
