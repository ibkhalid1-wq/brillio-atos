/**
 * LLM replay layer (audit T3/T7 harness).
 *
 * T3 (determinism) and T7 (retrieval isolation) cannot be run against a live
 * model - the output varies per call, so there is no fixed thing to assert. The
 * standard fix is a record/replay harness at the model-call boundary: capture
 * each (request -> response) once, then replay it so the SURROUNDING pipeline
 * (context assembly, retrieval scoping, parsing, grounding) runs deterministically
 * and its properties become testable.
 *
 * This module is the pure, transport-agnostic core of that harness:
 *   - fingerprintRequest: a stable content hash of a model request, with volatile
 *     fields (nonces, timestamps, run ids) excluded so the same logical request
 *     always keys the same fixture.
 *   - createReplayTransport: wraps a live caller with record / replay / strict /
 *     passthrough modes. In production nothing wraps anything (passthrough), so
 *     behaviour is unchanged; the harness only engages under an explicit config.
 *   - isolation helpers: requestMentions / assertNoForeignEvidence let a T7 test
 *     assert that programme A's assembled request carries none of programme B's
 *     evidence, and that a fixture recorded for A can never be silently served for
 *     B (the fingerprint incorporates the full evidence, so B is a cache miss, not
 *     a stale reuse).
 *
 * The real atos-flow model call happens SERVER-SIDE in the run-agent edge, which
 * the audit contract forbids deploying to. The Deno-side wiring that plugs this
 * core into that edge is delivered separately (supabase/functions/_shared) and is
 * NOT deployed - this file is the in-repo, unit-tested substrate it calls.
 */

/** One recorded model exchange. `channel` names the boundary ("run-agent"). */
export interface LlmExchange {
  channel: string;
  request: unknown;
  response: unknown;
  recordedAt?: string;
}

export interface LlmFixture extends LlmExchange {
  fingerprint: string;
}

export type ReplayMode = "replay" | "record" | "passthrough";

export interface ReplayConfig {
  mode: ReplayMode;
  /** Pre-recorded exchanges to replay from. */
  fixtures?: LlmFixture[];
  /** The real caller - invoked in record/passthrough, and on a miss when not strict. */
  live?: (channel: string, request: unknown) => Promise<unknown>;
  /** Request field names whose values are excluded from the fingerprint. */
  volatileKeys?: string[];
  /** Replay strictly: a cache miss throws instead of falling back to `live`. Default true. */
  strict?: boolean;
}

/** Thrown when a strict replay finds no fixture for a request. */
export class ReplayMissError extends Error {
  constructor(public channel: string, public fingerprint: string) {
    super(`No recorded fixture for ${channel} @ ${fingerprint} (strict replay)`);
    this.name = "ReplayMissError";
  }
}

const DEFAULT_VOLATILE = ["runId", "run_id", "nonce", "timestamp", "ts", "requestId", "request_id", "createdAt", "created_at"];

/**
 * Canonical, stable stringification: object keys sorted, arrays preserved,
 * volatile keys dropped at every depth. Two logically-identical requests
 * serialise identically regardless of key order or volatile noise.
 */
export function canonicalize(value: unknown, volatileKeys: string[] = DEFAULT_VOLATILE): string {
  const drop = new Set(volatileKeys);
  const walk = (node: unknown): unknown => {
    if (Array.isArray(node)) return node.map(walk);
    if (node && typeof node === "object") {
      const out: Record<string, unknown> = {};
      for (const key of Object.keys(node as Record<string, unknown>).sort()) {
        if (drop.has(key)) continue;
        out[key] = walk((node as Record<string, unknown>)[key]);
      }
      return out;
    }
    return node;
  };
  return JSON.stringify(walk(value));
}

/** FNV-1a 32-bit hash to 8-char hex. Not cryptographic - a stable fixture key. */
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/** A stable content fingerprint of a model request. */
export function fingerprintRequest(channel: string, request: unknown, volatileKeys: string[] = DEFAULT_VOLATILE): string {
  return fnv1a(`${channel} ${canonicalize(request, volatileKeys)}`);
}

export interface ReplayTransport {
  (channel: string, request: unknown): Promise<unknown>;
  /** Fixtures captured so far (record mode) - persist these to disk. */
  recorded(): LlmFixture[];
  /** Replay bookkeeping for assertions. */
  readonly stats: { hits: number; misses: number; recorded: number };
}

/**
 * Wrap a live model caller with record/replay semantics. Passthrough mode is a
 * no-op wrapper (production default), so wrapping is always safe.
 */
export function createReplayTransport(config: ReplayConfig): ReplayTransport {
  const volatileKeys = config.volatileKeys ?? DEFAULT_VOLATILE;
  const strict = config.strict ?? true;
  const byFingerprint = new Map<string, LlmFixture>();
  for (const fixture of config.fixtures ?? []) byFingerprint.set(fixture.fingerprint, fixture);
  const captured: LlmFixture[] = [];
  const stats = { hits: 0, misses: 0, recorded: 0 };

  const transport = (async (channel: string, request: unknown): Promise<unknown> => {
    const fingerprint = fingerprintRequest(channel, request, volatileKeys);

    if (config.mode === "replay") {
      const fixture = byFingerprint.get(fingerprint);
      if (fixture) {
        stats.hits += 1;
        return fixture.response;
      }
      stats.misses += 1;
      if (strict || !config.live) throw new ReplayMissError(channel, fingerprint);
      return config.live(channel, request);
    }

    if (config.mode === "record") {
      if (!config.live) throw new Error("record mode requires a live caller");
      const response = await config.live(channel, request);
      const fixture: LlmFixture = { fingerprint, channel, request, response };
      byFingerprint.set(fingerprint, fixture);
      captured.push(fixture);
      stats.recorded += 1;
      return response;
    }

    // passthrough
    if (!config.live) throw new Error("passthrough mode requires a live caller");
    return config.live(channel, request);
  }) as ReplayTransport;

  transport.recorded = () => captured.slice();
  Object.defineProperty(transport, "stats", { get: () => ({ ...stats }) });
  return transport;
}

/**
 * T3 helper. Run a replay transport N times over the same request and assert the
 * response is byte-identical every time - the determinism the model itself can't
 * give, now guaranteed for the pipeline downstream of it.
 */
export async function assertDeterministic(
  transport: ReplayTransport,
  channel: string,
  request: unknown,
  runs = 3,
): Promise<{ deterministic: boolean; distinct: number }> {
  const seen = new Set<string>();
  for (let i = 0; i < runs; i += 1) {
    const response = await transport(channel, request);
    seen.add(JSON.stringify(response));
  }
  return { deterministic: seen.size === 1, distinct: seen.size };
}

/**
 * T7 helper. Which of `needles` appear anywhere in the serialised request - used
 * to assert that programme A's assembled model request carries none of programme
 * B's evidence (an empty result = clean isolation).
 */
export function requestMentions(request: unknown, needles: string[]): string[] {
  const hay = JSON.stringify(request ?? "").toLowerCase();
  return needles.filter((needle) => needle.trim() && hay.includes(needle.trim().toLowerCase()));
}

/** T7 assertion: throw if any foreign-evidence needle leaked into the request. */
export function assertNoForeignEvidence(request: unknown, foreignEvidence: string[]): void {
  const leaked = requestMentions(request, foreignEvidence);
  if (leaked.length) {
    throw new Error(`Retrieval isolation breach: request carries foreign evidence - ${leaked.join(", ")}`);
  }
}
