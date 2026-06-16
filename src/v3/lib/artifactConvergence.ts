/**
 * Artifact convergence scoring (spec Change 10).
 *
 * The generation pipeline aims for *deterministic* regeneration: running a formal
 * artifact agent repeatedly against unchanged inputs should yield substantially
 * identical output (same structure, section ordering, naming, terminology — only
 * minor wording drift). This module provides a pure structural-similarity scorer
 * so that behaviour can be asserted in tests and in a live 3×-regeneration probe,
 * without needing the model itself.
 *
 * `structuralSimilarity` weights *shape* over *prose*: it compares key sets,
 * section ordering, and array structure, treating leaf strings with a forgiving
 * word-overlap measure. Provenance fields that legitimately vary per run
 * (timestamps, confidence, internal metadata) are ignored.
 */

const SKIP_KEYS = new Set(["generatedat", "confidence", "_generationmetadata"]);

function isSkippable(key: string): boolean {
  const k = key.toLowerCase();
  return SKIP_KEYS.has(k) || k.startsWith("_");
}

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function orderedKeys(obj: Record<string, unknown>): string[] {
  return Object.keys(obj).filter((k) => !isSkippable(k));
}

/** Forgiving leaf-string comparison: word-set overlap, case/whitespace-insensitive. */
function wordOverlap(a: string, b: string): number {
  const tok = (s: string) => s.toLowerCase().match(/[a-z0-9]+/g) ?? [];
  const wa = new Set(tok(a));
  const wb = new Set(tok(b));
  if (wa.size === 0 && wb.size === 0) return 1;
  if (wa.size === 0 || wb.size === 0) return 0;
  let inter = 0;
  for (const w of wa) if (wb.has(w)) inter += 1;
  return inter / (wa.size + wb.size - inter);
}

/** Positional ordering agreement over the keys both objects share. */
function orderSimilarity(keysA: string[], keysB: string[]): number {
  const shared = keysA.filter((k) => keysB.includes(k));
  if (shared.length <= 1) return 1;
  const seqA = shared;
  const seqB = keysB.filter((k) => shared.includes(k));
  let matches = 0;
  for (let i = 0; i < seqA.length; i += 1) if (seqA[i] === seqB[i]) matches += 1;
  return matches / seqA.length;
}

/**
 * Structural similarity of two generated artifacts, in [0, 1]. 1 means identical
 * shape and wording; lower values reflect structural drift (missing/renamed/
 * reordered sections) more heavily than pure rewording.
 */
export function structuralSimilarity(a: unknown, b: unknown): number {
  if (Array.isArray(a) && Array.isArray(b)) {
    const maxLen = Math.max(a.length, b.length);
    if (maxLen === 0) return 1;
    let sum = 0;
    for (let i = 0; i < Math.min(a.length, b.length); i += 1) sum += structuralSimilarity(a[i], b[i]);
    return sum / maxLen; // unmatched tail elements count as 0 → penalizes length drift
  }

  if (isPlainObject(a) && isPlainObject(b)) {
    const keysA = orderedKeys(a);
    const keysB = orderedKeys(b);
    const union = new Set([...keysA, ...keysB]);
    if (union.size === 0) return 1;
    const shared = keysA.filter((k) => keysB.includes(k));
    const keyJaccard = shared.length / union.size;
    const order = orderSimilarity(keysA, keysB);
    const valScore = shared.length === 0
      ? 0
      : shared.reduce((sum, k) => sum + structuralSimilarity(a[k], b[k]), 0) / shared.length;
    // Shape (keys + order) dominates; values still matter for terminology drift.
    return 0.4 * keyJaccard + 0.2 * order + 0.4 * (shared.length === 0 ? keyJaccard : valScore);
  }

  if (typeof a === "string" && typeof b === "string") return wordOverlap(a, b);
  if (typeof a === "number" && typeof b === "number") return a === b ? 1 : 0;
  if (typeof a === "boolean" && typeof b === "boolean") return a === b ? 1 : 0;
  if (a === null && b === null) return 1;
  if (a === undefined && b === undefined) return 1;
  return 0; // type mismatch
}

/**
 * Mean pairwise structural similarity across a series of regenerations of the
 * same artifact. Feed the parsed JSON output of each run (e.g. generate, then
 * two regenerations on identical inputs). Returns 1 for a single run.
 */
export function convergenceScore(runs: unknown[]): number {
  if (runs.length < 2) return 1;
  let sum = 0;
  let pairs = 0;
  for (let i = 0; i < runs.length; i += 1) {
    for (let j = i + 1; j < runs.length; j += 1) {
      sum += structuralSimilarity(runs[i], runs[j]);
      pairs += 1;
    }
  }
  return pairs === 0 ? 1 : sum / pairs;
}

/** Default convergence target for unchanged-input regenerations (95%+). */
export const CONVERGENCE_TARGET = 0.95;

export function meetsConvergenceTarget(score: number, target: number = CONVERGENCE_TARGET): boolean {
  return score >= target;
}
