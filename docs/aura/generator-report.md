# Aura — The claims-emitting generator: GATED (no Deno/edge runtime this session)

**Status: not started. The gate held.** The build was explicitly gated on the edge/Deno runtime being
available and *runnable* this session — "specifying more of this on paper is not the bottleneck; running
it is." It is not runnable. Per the rule, this stops here rather than stubbing or spec-ing more on paper.

## Runtime verification (done first, as required)

| Requirement | Result |
|---|---|
| `deno` on PATH | **NOT FOUND** |
| `supabase` CLI (to serve/run edge functions) | **NOT FOUND** |
| any `deno` binary under `~/tools`, `~/.deno`, `/usr/local/bin`, `/opt/homebrew/bin` | **none** |
| `deno.json` / `import_map.json` (repo or `supabase/functions/`) | **none** |
| `node` (for context) | present, v24.15.0 at `~/tools/node/bin` |

The generator is Deno edge code: the artifact generators run through
`supabase/functions/run-agent/index.ts` + `supabase/functions/_shared/claudeClient.ts` /
`llmReplay.ts`. None of it is executable here — no Deno to run it, no Supabase CLI to serve it, and the
client `tsconfig` includes only `src/**`, so `supabase/functions/**` can't even be typechecked locally.
This matches the standing record that edge/Deno code has had no executable verification all project.

## Why "run it in Node instead" is not the move

The validator and the batch shape are runtime-agnostic TypeScript and *could* run under Node. But the
session's point — and its gate — is the **generator**: a model emitting claims-with-unknowns against
**real Laila input**, proven end-to-end through the proven reconcile. The prompt is explicit that
*fixtures prove the contract, real input proves the unknowns are real*. Real-input proof needs the
generator (a model call) actually running, which needs the Deno edge runtime + model access. Building
only the Node-runnable slice and hand-authoring a fixture batch would be stubbing the gated core and
calling it done — exactly what the rules forbid ("don't stub"). So this reports the gate instead.

## What is ready the moment the runtime exists (nothing here is the blocker)

The generator conforms to a substrate that is **complete, proven, and frozen** — its whole downstream is
already built and DB-verified, so only the generator itself remains:

- **The batch shape reconcile consumes** — `AssertInput[]` + the elements array — is the exact Option-A
  input. `PgLedger.reconcile` is proven across the multi-round arc (no loss, no accumulation, precedence
  stable, elements maintained, orphans findable, collisions isolated, all audited).
- **The contract** is written: `docs/aura/ledger-generation-contract.md` (the output schema in prose,
  `generated`-only source ceiling, unknowns-emitted-not-omitted, binder discipline).
- **The multi-round harness** (`scripts/ledger/reconcile-multiround.ts`) is ready to host a
  generator-fed round in place of a blob-fed one.
- **`migrate()`** already demonstrates the target behavior on the extraction side — every slot a claim,
  explicit `?unknown` with an owner (F-D/F-F/F-G), `generated` for model-written prose — so the
  generator's conformance target is concrete, not hypothetical.

## What unblocks this session (any one)

1. **Install Deno** locally (`~/.deno`, no sudo needed) **and** provide edge-runnable model access
   (an Anthropic key the function can use, or the existing `llmReplay` fixtures for a deterministic
   run). Then: build the executable contract + validator, run the generator against real Laila input,
   count the emitted unknowns, and feed one generator round through reconcile in the harness. This is
   the full deliverable and needs the model actually running.
   - *I did not install Deno autonomously* — provisioning a runtime + wiring model credentials is a
     system/credential action to leave with you, same discipline as not creating cloud accounts. Say
     the word and I'll run the official install and proceed.
2. **Or** the Supabase CLI + a local functions runtime (`supabase functions serve`), same effect.
3. **Or**, if you want the *contract exercised now without the model*: I can build the validator + a
   fixture-fed reconcile round **in Node** and show the validator rejecting a malformed batch. Flag this
   plainly — it proves the contract and the plumbing, **not** that the unknowns are real (that needs the
   generator on real input). This is a reduced, explicitly-labeled slice, offered only because you might
   want it; it is not the gated deliverable.

## Nothing was built, stubbed, or changed

No generator code, no validator, no paper-spec beyond this record. The ledger core, store, precedence,
reconcile, and audit trigger are untouched (and proven). Re-issue with the runtime present — or approve
option 1 — and the build runs against real Laila input and the live DB.
