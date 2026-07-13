// LLM replay layer - edge side (audit T3/T7 harness). DELIVERED, NOT DEPLOYED.
//
// The audit contract (Rule 6) forbids deploying to the shared Supabase project,
// so this file is provided for the edge owner to wire and deploy intentionally.
// It is the Deno-side mirror of the in-repo, unit-tested core at
// src/v3/lib/llmReplay.ts (see that file for the rationale and the client-side
// tests that prove the T3/T7 semantics). Keeping the two in lockstep is a
// one-function copy: fingerprintRequest + wrapCompletion below. A client/edge
// parity test (llmReplay.test.ts) asserts the two fingerprints never diverge.
//
// WHY HERE: the real atos-flow model call happens in this edge, inside
// _shared/claudeClient.ts -> completeClaudeText(). That is the only point where a
// recorded request/response pair reproduces a real generation, so it is the only
// honest home for a replay layer that can make T3 (determinism) and T7
// (retrieval isolation) runnable end-to-end.
//
// WIRING (run-agent/index.ts, wherever completeClaudeText is called):
//
//   import { wrapCompletion } from "../_shared/llmReplay.ts";
//   import { completeClaudeText } from "../_shared/claudeClient.ts";
//   const complete = wrapCompletion(completeClaudeText);   // passthrough unless ATOS_LLM_REPLAY set
//   const result = await complete(options);                // replaces the direct call
//
// GATING: honours Deno.env ATOS_LLM_REPLAY = "record" | "replay" | "" (default
// off -> passthrough, so production behaviour is byte-identical). In record mode
// it appends fixtures to ATOS_REPLAY_DIR; in replay mode it loads them and serves
// recorded responses, throwing on a strict cache miss.

const DEFAULT_VOLATILE = ["runId", "run_id", "nonce", "timestamp", "ts", "requestId", "request_id", "createdAt", "created_at"];

export function canonicalize(value: unknown, volatile: string[] = DEFAULT_VOLATILE): string {
  const drop = new Set(volatile);
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

// FNV-1a 32-bit to 8 hex. Must match src/v3/lib/llmReplay.ts exactly.
function fnv1a(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function fingerprintRequest(channel: string, request: unknown, volatile: string[] = DEFAULT_VOLATILE): string {
  return fnv1a(`${channel} ${canonicalize(request, volatile)}`);
}

type Completion<O, R> = (options: O) => Promise<R>;

/**
 * Wrap the edge's completeClaudeText with record/replay. Passthrough (production
 * default) is a no-op wrapper, so wiring this in is always safe. Fixtures live in
 * a directory named by ATOS_REPLAY_DIR (one JSON file per fingerprint) so a
 * record session on a real key produces a corpus the audit's T3/T7 can replay.
 */
export function wrapCompletion<O extends Record<string, unknown>, R>(live: Completion<O, R>): Completion<O, R> {
  const env = (key: string): string => {
    try { return (globalThis as { Deno?: { env: { get(k: string): string | undefined } } }).Deno?.env.get(key) ?? ""; }
    catch { return ""; }
  };
  const mode = env("ATOS_LLM_REPLAY");
  if (mode !== "record" && mode !== "replay") return live; // passthrough - unchanged behaviour
  const dir = env("ATOS_REPLAY_DIR") || "/tmp/atos-replay";
  const channel = "run-agent";

  // Structural type for the Deno FS API used here, so this file type-checks under
  // the client tsconfig too (the parity test imports it) without Deno lib types.
  type DenoFs = {
    readTextFile(p: string): Promise<string>;
    writeTextFile(p: string, s: string): Promise<void>;
    mkdir(p: string, o: { recursive: boolean }): Promise<void>;
  };
  return async (options: O): Promise<R> => {
    const fp = fingerprintRequest(channel, options);
    const path = `${dir}/${fp}.json`;
    const deno = (globalThis as { Deno?: DenoFs }).Deno;
    if (mode === "replay") {
      try {
        const raw = await deno!.readTextFile(path);
        return (JSON.parse(raw) as { response: R }).response;
      } catch {
        throw new Error(`ReplayMiss: no fixture for ${channel} @ ${fp} (strict replay)`);
      }
    }
    // record
    const response = await live(options);
    try {
      await deno!.mkdir(dir, { recursive: true });
      await deno!.writeTextFile(path, JSON.stringify({ fingerprint: fp, channel, request: options, response }));
    } catch { /* recording is best-effort; never break a live run */ }
    return response;
  };
}
