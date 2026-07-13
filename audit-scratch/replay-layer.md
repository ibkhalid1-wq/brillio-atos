# LLM Replay Layer — status (unblocks T3 / T7)

## What was built (in-repo, verified)
- **`src/v3/lib/llmReplay.ts`** — the pure, transport-agnostic core: stable request
  `fingerprintRequest` (volatile fields excluded), `createReplayTransport`
  (record / replay / strict / passthrough), and the T3/T7 assertion helpers
  (`assertDeterministic`, `requestMentions`, `assertNoForeignEvidence`).
- **`supabase/functions/_shared/llmReplay.ts`** — the Deno mirror + `wrapCompletion`,
  the wrapper for the edge's real model boundary (`completeClaudeText`). **Delivered,
  NOT deployed** (contract Rule 6). Passthrough unless `ATOS_LLM_REPLAY` is set, so
  wiring it in is byte-identical to today in production.
- **`src/v3/__tests__/llmReplay.test.ts`** — 12 tests: fingerprint stability, **T3
  determinism** (replay is byte-identical across runs; strict miss throws),
  **T7 isolation** (a fixture recorded for programme A is a cache MISS for B — never a
  stale reuse; foreign evidence in an assembled request is detected), and a
  **client/edge lockstep parity** test that pins the two fingerprint implementations
  together (it already caught a real corruption bug — a non-ASCII byte in the client
  file that made its hash diverge; without the parity test, recorded fixtures would
  silently never replay).

## What it unblocks
- **T3 (determinism)** and **T7 (retrieval isolation)** now have a runnable harness:
  the *semantics* are proven in-repo, and the substrate to replay real generations is
  in place.

## The remaining gate (owner decision, not more code)
The real atos-flow generation happens **server-side in the run-agent edge**
(`completeClaudeText`); the client sees only a status envelope, and the artifact is
written to the DB by the edge. So **full end-to-end T3/T7 execution requires wiring
`wrapCompletion` into run-agent and deploying it** to record a fixture corpus against
a real key. That is a production-edge deploy, which the audit contract forbids me from
doing autonomously. The wiring is a 3-line change (documented at the top of the edge
shim). Once deployed in record mode for one session, T3/T7 run offline against the
captured fixtures.

## Note tying the findings together
This same edge-deploy gate is what the **F-003** re-key (fact/graph derivation to the
flow phase model) needs to be honestly verified — both are generation-behaviour changes
that the replay layer is designed to make testable. The replay layer is therefore the
single enabling dependency for the remaining audit surface.
