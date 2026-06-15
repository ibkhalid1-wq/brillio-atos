/**
 * Intelligence reuse, evidence fingerprinting & cascade-skip governance —
 * "no meaningful change → no AI execution."
 *
 * The mandate's core economic rule: ATOS should consume tokens only when new
 * information creates new intelligence, and must never repeatedly rediscover
 * what it already knows. Before any (re)generation we must answer: has the
 * evidence/context this output depends on actually changed in a way that
 * matters? If not, reuse the persisted intelligence and skip the call entirely.
 *
 * This pure module provides:
 *   • fingerprint()         — a stable, order-independent hash of an output's
 *                             inputs, with semantic normalisation so whitespace
 *                             / casing / formatting churn does NOT change it.
 *   • decideReuse()         — the reuse-vs-regenerate predicate driven by
 *                             fingerprint equality plus readiness/confidence
 *                             change signals and explicit user force.
 *   • filterFreshDownstream() — cascade-skip governance: when an agent reruns,
 *                             only run the downstream agents whose own inputs
 *                             actually changed, instead of the whole cascade.
 *
 * No AI, no backend, fully deterministic and unit-testable.
 */

/** Collapse whitespace, trim and lowercase a string so cosmetic edits don't churn the fingerprint. */
function normalizeString(value: string): string {
  return value.replace(/\s+/g, " ").trim().toLowerCase();
}

/**
 * Recursively normalise a value for fingerprinting: object keys are sorted so
 * field order is irrelevant, strings are whitespace/case-normalised, and
 * null/undefined collapse together. The result is a canonical, comparable form.
 */
export function canonicalize(value: unknown): unknown {
  if (value == null) return null;
  if (typeof value === "string") return normalizeString(value);
  if (typeof value === "number" || typeof value === "boolean") return value;
  if (Array.isArray(value)) return value.map(canonicalize);
  if (typeof value === "object") {
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      out[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return out;
  }
  // functions / symbols / bigints — not part of evidence; ignore.
  return null;
}

/** Deterministic FNV-1a 32-bit hash, returned as 8-char hex. Stable across runs. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // hash *= 16777619, kept in 32-bit space.
    hash = Math.imul(hash, 0x01000193);
  }
  // Coerce to unsigned and hex-pad.
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Stable fingerprint of an output's inputs. Pass the evidence/context the output
 * depends on (scoped context digest, key fields, prior version id, etc.). Equal
 * meaning → equal fingerprint, regardless of key order or cosmetic formatting.
 */
export function fingerprint(...parts: unknown[]): string {
  const canonical = parts.length === 1 ? canonicalize(parts[0]) : parts.map(canonicalize);
  return fnv1a(JSON.stringify(canonical));
}

export interface ReuseInputs {
  /** Fingerprint of the current inputs/evidence for this output. */
  currentFingerprint: string;
  /** Fingerprint recorded when the prior output was generated (null if none). */
  priorFingerprint: string | null;
  /** Whether a usable prior output already exists to reuse. */
  hasPriorOutput: boolean;
  /** Explicit user-requested regeneration overrides reuse. */
  forced?: boolean;
  /** Readiness materially changed since last generation (forces regen). */
  readinessChanged?: boolean;
  /** Confidence materially changed since last generation (forces regen). */
  confidenceChanged?: boolean;
}

export type ReuseAction = "reuse" | "regenerate";

export interface ReuseDecision {
  action: ReuseAction;
  reason: string;
}

/**
 * Decide whether to reuse persisted intelligence or regenerate. Quality-first:
 * any genuine change signal (new evidence, readiness/confidence shift, explicit
 * force, or missing prior output) regenerates; otherwise reuse and skip the AI
 * call. This is the single gate every regenerable capability should consult.
 */
export function decideReuse(inputs: ReuseInputs): ReuseDecision {
  if (inputs.forced) {
    return { action: "regenerate", reason: "User requested regeneration." };
  }
  if (!inputs.hasPriorOutput || inputs.priorFingerprint == null) {
    return { action: "regenerate", reason: "No prior intelligence to reuse." };
  }
  if (inputs.readinessChanged) {
    return { action: "regenerate", reason: "Readiness changed since last generation." };
  }
  if (inputs.confidenceChanged) {
    return { action: "regenerate", reason: "Confidence changed since last generation." };
  }
  if (inputs.currentFingerprint !== inputs.priorFingerprint) {
    return { action: "regenerate", reason: "Evidence changed since last generation." };
  }
  return { action: "reuse", reason: "Inputs unchanged — reusing persisted intelligence." };
}

/** Convenience boolean: should this output be regenerated? */
export function shouldRegenerate(inputs: ReuseInputs): boolean {
  return decideReuse(inputs).action === "regenerate";
}

export interface CascadeCandidate {
  agentId: string;
  phaseId: string;
}

export interface CascadeFilterResult<T extends CascadeCandidate> {
  /** Downstream candidates whose inputs changed — these should run. */
  run: T[];
  /** Downstream candidates that are fresh — skipped to save tokens. */
  skipped: T[];
}

/**
 * Cascade-skip governance. When an agent reruns, ATOS today fans out to a fixed
 * set of downstream agents regardless of whether their own inputs changed. This
 * splits a downstream list into the ones that actually need to run (per the
 * caller's staleness predicate) and the ones to skip — turning an unconditional
 * cascade into an event-driven one.
 */
export function filterFreshDownstream<T extends CascadeCandidate>(
  downstream: T[],
  isStale: (candidate: T) => boolean,
): CascadeFilterResult<T> {
  const run: T[] = [];
  const skipped: T[] = [];
  for (const candidate of downstream) {
    if (isStale(candidate)) run.push(candidate);
    else skipped.push(candidate);
  }
  return { run, skipped };
}
