// Shared phase-input bucket merge. Kept as a lib helper (not inline in a
// component) so every writer of phaseInputs merges identically — the direct
// document-import save (AppShell) and the change-request approval apply
// (useGateReview) both fold incoming fields onto the existing bucket the same
// way, including deep-merging per-field provenance.

import { mergeProvenance, PROVENANCE_KEY } from "@/new/lib/fieldProvenance";

/**
 * Merge an incoming set of phase-input fields onto a phase's existing input
 * bucket without losing per-field provenance. Incoming (new/updated) fields win;
 * the `_provenance` metadata bucket is deep-merged via {@link mergeProvenance} so
 * a partial import never drops provenance recorded for fields it doesn't touch.
 * Stamps a fresh `savedAt`.
 */
export function mergePhaseInputBucket(
  prevBucket: unknown,
  inputs: Record<string, string>,
): Record<string, unknown> {
  const prev = (typeof prevBucket === "object" && prevBucket !== null ? prevBucket : {}) as Record<string, unknown>;
  const mergedProvenance = mergeProvenance(prev[PROVENANCE_KEY], inputs[PROVENANCE_KEY]);
  const bucket: Record<string, unknown> = { ...prev, ...inputs, savedAt: new Date().toISOString() };
  if (mergedProvenance) bucket[PROVENANCE_KEY] = mergedProvenance;
  else delete bucket[PROVENANCE_KEY];
  return bucket;
}
